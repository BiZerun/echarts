/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

/* global Float64Array, Int32Array, Uint32Array, Uint16Array */

/**
 * List for data storage
 */

import {__DEV__} from '../config';
import * as zrUtil from 'zrender/src/core/util';
import Model from '../model/Model';
import DataDiffer from './DataDiffer';
import Source from './Source';
import {DefaultDataProvider, DataProvider} from './helper/dataProvider';
import {summarizeDimensions, DimensionSummary} from './helper/dimensionHelper';
import DataDimensionInfo from './DataDimensionInfo';
import {ArrayLike, Dictionary, FunctionPropertyNames} from 'zrender/src/core/types';
import Element from 'zrender/src/Element';
import {
    DimensionIndex, DimensionName, DimensionLoose, OptionDataItem,
    ParsedValue, ParsedValueNumeric, OrdinalNumber, DimensionUserOuput, ModelOption
} from '../util/types';
import {parseDate} from '../util/number';
import {isDataItemOption} from '../util/model';
import type Graph from './Graph';
import type Tree from './Tree';
import { getECData } from '../util/graphic';


const isObject = zrUtil.isObject;

const UNDEFINED = 'undefined';
const INDEX_NOT_FOUND = -1;

// Use prefix to avoid index to be the same as otherIdList[idx],
// which will cause weird udpate animation.
const ID_PREFIX = 'e\0\0';

const dataCtors = {
    'float': typeof Float64Array === UNDEFINED
        ? Array : Float64Array,
    'int': typeof Int32Array === UNDEFINED
        ? Array : Int32Array,
    // Ordinal data type can be string or int
    'ordinal': Array,
    'number': Array,
    'time': Array
};

export type ListDimensionType = keyof typeof dataCtors;

// Caution: MUST not use `new CtorUint32Array(arr, 0, len)`, because the Ctor of array is
// different from the Ctor of typed array.
const CtorUint32Array = typeof Uint32Array === UNDEFINED ? Array : Uint32Array;
const CtorInt32Array = typeof Int32Array === UNDEFINED ? Array : Int32Array;
const CtorUint16Array = typeof Uint16Array === UNDEFINED ? Array : Uint16Array;

type DataTypedArray = Uint32Array | Int32Array | Uint16Array | Float64Array;
type DataTypedArrayConstructor = typeof Uint32Array | typeof Int32Array | typeof Uint16Array | typeof Float64Array;
type DataArrayLikeConstructor = typeof Array | DataTypedArrayConstructor;



type DimValueGetter = (
    this: List,
    dataItem: any,
    dimName: DimensionName,
    dataIndex: number,
    dimIndex: DimensionIndex
) => ParsedValue;

type DataValueChunk = ArrayLike<ParsedValue>;
type DataStorage = {[dimName: string]: DataValueChunk[]};
type NameRepeatCount = {[name: string]: number};


type ItrParamDims = DimensionLoose | Array<DimensionLoose>;
// If Ctx not specified, use List as Ctx
type CtxOrList<Ctx> = unknown extends Ctx ? List : Ctx;
type EachCb0<Ctx> = (this: CtxOrList<Ctx>, idx: number) => void;
type EachCb1<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, idx: number) => void;
type EachCb2<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, y: ParsedValue, idx: number) => void;
type EachCb<Ctx> = (this: CtxOrList<Ctx>, ...args: any) => void;
type FilterCb0<Ctx> = (this: CtxOrList<Ctx>, idx: number) => boolean;
type FilterCb1<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, idx: number) => boolean;
type FilterCb2<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, y: ParsedValue, idx: number) => boolean;
type FilterCb<Ctx> = (this: CtxOrList<Ctx>, ...args: any) => boolean;
type MapArrayCb0<Ctx> = (this: CtxOrList<Ctx>, idx: number) => any;
type MapArrayCb1<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, idx: number) => any;
type MapArrayCb2<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, y: ParsedValue, idx: number) => any;
type MapArrayCb<Ctx> = (this: CtxOrList<Ctx>, ...args: any) => any;
type MapCb1<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, idx: number) => ParsedValue | ParsedValue[];
type MapCb2<Ctx> = (this: CtxOrList<Ctx>, x: ParsedValue, y: ParsedValue, idx: number) =>
    ParsedValue | ParsedValue[];
type MapCb<Ctx> = (this: CtxOrList<Ctx>, ...args: any) => ParsedValue | ParsedValue[];



const TRANSFERABLE_PROPERTIES = [
    'hasItemOption', '_nameList', '_idList', '_invertedIndicesMap',
    '_rawData', '_chunkSize', '_chunkCount', '_dimValueGetter',
    '_count', '_rawCount', '_nameDimIdx', '_idDimIdx'
];
const CLONE_PROPERTIES = [
    '_extent', '_approximateExtent', '_rawExtent'
];


class List<HostModel extends Model = Model> {

    readonly type = 'list';

    readonly dimensions: string[];

    // Infomation of each data dimension, like data type.
    private _dimensionInfos: {[dimName: string]: DataDimensionInfo};

    readonly hostModel: HostModel;

    readonly dataType: string;

    /**
     * Host graph if List is used to store graph nodes / edges.
     */
    readonly graph?: Graph;
    /**
     * Host tree if List is used to store tree ndoes.
     */
    readonly tree?: Tree;

    // Indices stores the indices of data subset after filtered.
    // This data subset will be used in chart.
    private _indices: ArrayLike<any>;

    private _count: number = 0;
    private _rawCount: number = 0;
    private _storage: DataStorage = {};
    private _nameList: string[] = [];
    private _idList: string[] = [];

    // Models of data option is stored sparse for optimizing memory cost
    // Never used yet (not used yet).
    // private _optionModels: Model[] = [];

    // Global visual properties after visual coding
    private _visual: Dictionary<any> = {};

    // Globel layout properties.
    private _layout: Dictionary<any> = {};

    // Item visual properties after visual coding
    private _itemVisuals: Dictionary<any>[] = [];

    // Key: visual type, Value: boolean
    // @readonly
    hasItemVisual: Dictionary<boolean> = {};

    // Item layout properties after layout
    private _itemLayouts: any[] = [];

    // Graphic elemnents
    private _graphicEls: Element[] = [];

    // Max size of each chunk.
    private _chunkSize: number = 1e5;

    private _chunkCount: number = 0;

    private _rawData: DataProvider;

    // Raw extent will not be cloned, but only transfered.
    // It will not be calculated util needed.
    private _rawExtent: {[dimName: string]: [number, number]} = {};

    private _extent: {[dimName: string]: [number, number]} = {};

    // key: dim, value: extent
    private _approximateExtent: {[dimName: string]: [number, number]} = {};

    private _dimensionsSummary: DimensionSummary;

    private _invertedIndicesMap: {[dimName: string]: ArrayLike<number>};

    private _calculationInfo: {[key: string]: any} = {};

    // User output info of this data.
    // DO NOT use it in other places!
    // When preparing user params for user callbacks, we have
    // to clone these inner data structures to prevent users
    // from modifying them to effect built-in logic. And for
    // performance consideration we make this `userOutput` to
    // avoid clone them too many times.
    readonly userOutput: DimensionUserOuput;

    // If each data item has it's own option
    hasItemOption: boolean = true;

    // @readonly
    defaultDimValueGetter: DimValueGetter;
    private _dimValueGetter: DimValueGetter;
    private _dimValueGetterArrayRows: DimValueGetter;

    private _nameRepeatCount: NameRepeatCount;
    private _nameDimIdx: number;
    private _idDimIdx: number;

    private __wrappedMethods: string[];

    // Methods that create a new list based on this list should be listed here.
    // Notice that those method should `RETURN` the new list.
    TRANSFERABLE_METHODS = ['cloneShallow', 'downSample', 'map'];
    // Methods that change indices of this list should be listed here.
    CHANGABLE_METHODS = ['filterSelf', 'selectRange'];


    /**
     * @param dimensions
     *        For example, ['someDimName', {name: 'someDimName', type: 'someDimType'}, ...].
     *        Dimensions should be concrete names like x, y, z, lng, lat, angle, radius
     */
    constructor(dimensions: Array<string | object | DataDimensionInfo>, hostModel: HostModel) {
        dimensions = dimensions || ['x', 'y'];

        let dimensionInfos: Dictionary<DataDimensionInfo> = {};
        let dimensionNames = [];
        let invertedIndicesMap: Dictionary<number[]> = {};

        for (let i = 0; i < dimensions.length; i++) {
            // Use the original dimensions[i], where other flag props may exists.
            let dimInfoInput = dimensions[i];

            let dimensionInfo: DataDimensionInfo =
                zrUtil.isString(dimInfoInput)
                ? new DataDimensionInfo({name: dimInfoInput})
                : !(dimInfoInput instanceof DataDimensionInfo)
                ? new DataDimensionInfo(dimInfoInput)
                : dimInfoInput;

            let dimensionName = dimensionInfo.name;
            dimensionInfo.type = dimensionInfo.type || 'float';
            if (!dimensionInfo.coordDim) {
                dimensionInfo.coordDim = dimensionName;
                dimensionInfo.coordDimIndex = 0;
            }

            dimensionInfo.otherDims = dimensionInfo.otherDims || {};
            dimensionNames.push(dimensionName);
            dimensionInfos[dimensionName] = dimensionInfo;

            dimensionInfo.index = i;

            if (dimensionInfo.createInvertedIndices) {
                invertedIndicesMap[dimensionName] = [];
            }
        }

        this.dimensions = dimensionNames;
        this._dimensionInfos = dimensionInfos;
        this.hostModel = hostModel;

        // Cache summary info for fast visit. See "dimensionHelper".
        this._dimensionsSummary = summarizeDimensions(this);

        this._invertedIndicesMap = invertedIndicesMap;

        this.userOutput = this._dimensionsSummary.userOutput;
    }

    /**
     * The meanings of the input parameter `dim`:
     *
     * + If dim is a number (e.g., `1`), it means the index of the dimension.
     *   For example, `getDimension(0)` will return 'x' or 'lng' or 'radius'.
     * + If dim is a number-like string (e.g., `"1"`):
     *     + If there is the same concrete dim name defined in `this.dimensions`, it means that concrete name.
     *     + If not, it will be converted to a number, which means the index of the dimension.
     *        (why? because of the backward compatbility. We have been tolerating number-like string in
     *        dimension setting, although now it seems that it is not a good idea.)
     *     For example, `visualMap[i].dimension: "1"` is the same meaning as `visualMap[i].dimension: 1`,
     *     if no dimension name is defined as `"1"`.
     * + If dim is a not-number-like string, it means the concrete dim name.
     *   For example, it can be be default name `"x"`, `"y"`, `"z"`, `"lng"`, `"lat"`, `"angle"`, `"radius"`,
     *   or customized in `dimensions` property of option like `"age"`.
     *
     * Get dimension name
     * @param dim See above.
     * @return Concrete dim name.
     */
    getDimension(dim: DimensionLoose): DimensionName {
        if (typeof dim === 'number'
            // If being a number-like string but not being defined a dimension name.
            || (!isNaN(dim as any) && !this._dimensionInfos.hasOwnProperty(dim))
        ) {
            dim = this.dimensions[dim as DimensionIndex];
        }
        return dim as DimensionName;
    }

    /**
     * Get type and calculation info of particular dimension
     * @param dim
     *        Dimension can be concrete names like x, y, z, lng, lat, angle, radius
     *        Or a ordinal number. For example getDimensionInfo(0) will return 'x' or 'lng' or 'radius'
     */
    getDimensionInfo(dim: DimensionLoose): DataDimensionInfo {
        // Do not clone, because there may be categories in dimInfo.
        return this._dimensionInfos[this.getDimension(dim)];
    }

    /**
     * concrete dimension name list on coord.
     */
    getDimensionsOnCoord(): DimensionName[] {
        return this._dimensionsSummary.dataDimsOnCoord.slice();
    }

    /**
     * @param coordDim
     * @param idx A coordDim may map to more than one data dim.
     *        If idx is `true`, return a array of all mapped dims.
     *        If idx is not specified, return the first dim not extra.
     * @return concrete data dim.
     *        If idx is number, and not found, return null/undefined.
     *        If idx is `true`, and not found, return empty array (always return array).
     */
    mapDimension(coordDim: DimensionName): DimensionName;
    mapDimension(coordDim: DimensionName, idx: true): DimensionName[];
    mapDimension(coordDim: DimensionName, idx: number): DimensionName;
    mapDimension(coordDim: DimensionName, idx?: true | number): DimensionName | DimensionName[] {
        let dimensionsSummary = this._dimensionsSummary;

        if (idx == null) {
            return dimensionsSummary.encodeFirstDimNotExtra[coordDim] as any;
        }

        let dims = dimensionsSummary.encode[coordDim];
        return idx === true
            // always return array if idx is `true`
            ? (dims || []).slice()
            : (dims ? dims[idx as number] as any : null);
    }

    /**
     * Initialize from data
     * @param data source or data or data provider.
     * @param nameLIst The name of a datum is used on data diff and
     *        defualt label/tooltip.
     *        A name can be specified in encode.itemName,
     *        or dataItem.name (only for series option data),
     *        or provided in nameList from outside.
     */
    initData(
        data: any,
        nameList?: string[],
        dimValueGetter?: DimValueGetter
    ): void {

        let notProvider = data instanceof Source || zrUtil.isArrayLike(data);
        if (notProvider) {
            data = new DefaultDataProvider(data, this.dimensions.length);
        }

        if (__DEV__) {
            if (!notProvider
                && (typeof data.getItem !== 'function' || typeof data.count !== 'function')
            ) {
                throw new Error('Inavlid data provider.');
            }
        }

        this._rawData = data;

        // Clear
        this._storage = {};
        this._indices = null;

        this._nameList = nameList || [];

        this._idList = [];

        this._nameRepeatCount = {};

        if (!dimValueGetter) {
            this.hasItemOption = false;
        }

        this.defaultDimValueGetter = defaultDimValueGetters[
            this._rawData.getSource().sourceFormat
        ];
        // Default dim value getter
        this._dimValueGetter = dimValueGetter = dimValueGetter
            || this.defaultDimValueGetter;
        this._dimValueGetterArrayRows = defaultDimValueGetters.arrayRows;

        // Reset raw extent.
        this._rawExtent = {};

        this._initDataFromProvider(0, data.count());

        // If data has no item option.
        if (data.pure) {
            this.hasItemOption = false;
        }
    }

    getProvider(): DataProvider {
        return this._rawData;
    }

    /**
     * Caution: Can be only called on raw data (before `this._indices` created).
     */
    appendData(data: ArrayLike<any>): void {
        if (__DEV__) {
            zrUtil.assert(!this._indices, 'appendData can only be called on raw data.');
        }

        let rawData = this._rawData;
        let start = this.count();
        rawData.appendData(data);
        let end = rawData.count();
        if (!rawData.persistent) {
            end += start;
        }
        this._initDataFromProvider(start, end);
    }

    /**
     * Caution: Can be only called on raw data (before `this._indices` created).
     * This method does not modify `rawData` (`dataProvider`), but only
     * add values to storage.
     *
     * The final count will be increased by `Math.max(values.length, names.length)`.
     *
     * @param values That is the SourceType: 'arrayRows', like
     *        [
     *            [12, 33, 44],
     *            [NaN, 43, 1],
     *            ['-', 'asdf', 0]
     *        ]
     *        Each item is exaclty cooresponding to a dimension.
     */
    appendValues(values: any[][], names?: string[]): void {
        let chunkSize = this._chunkSize;
        let storage = this._storage;
        let dimensions = this.dimensions;
        let dimLen = dimensions.length;
        let rawExtent = this._rawExtent;

        let start = this.count();
        let end = start + Math.max(values.length, names ? names.length : 0);
        let originalChunkCount = this._chunkCount;

        for (let i = 0; i < dimLen; i++) {
            let dim = dimensions[i];
            if (!rawExtent[dim]) {
                rawExtent[dim] = getInitialExtent();
            }
            if (!storage[dim]) {
                storage[dim] = [];
            }
            prepareChunks(storage, this._dimensionInfos[dim], chunkSize, originalChunkCount, end);
            this._chunkCount = storage[dim].length;
        }

        let emptyDataItem = new Array(dimLen);
        for (let idx = start; idx < end; idx++) {
            let sourceIdx = idx - start;
            let chunkIndex = Math.floor(idx / chunkSize);
            let chunkOffset = idx % chunkSize;

            // Store the data by dimensions
            for (let k = 0; k < dimLen; k++) {
                let dim = dimensions[k];
                let val = this._dimValueGetterArrayRows(
                    values[sourceIdx] || emptyDataItem, dim, sourceIdx, k
                ) as ParsedValueNumeric;
                storage[dim][chunkIndex][chunkOffset] = val;

                let dimRawExtent = rawExtent[dim];
                val < dimRawExtent[0] && (dimRawExtent[0] = val);
                val > dimRawExtent[1] && (dimRawExtent[1] = val);
            }

            if (names) {
                this._nameList[idx] = names[sourceIdx];
            }
        }

        this._rawCount = this._count = end;

        // Reset data extent
        this._extent = {};

        prepareInvertedIndex(this);
    }

    private _initDataFromProvider(start: number, end: number): void {
        if (start >= end) {
            return;
        }

        let chunkSize = this._chunkSize;
        let rawData = this._rawData;
        let storage = this._storage;
        let dimensions = this.dimensions;
        let dimLen = dimensions.length;
        let dimensionInfoMap = this._dimensionInfos;
        let nameList = this._nameList;
        let idList = this._idList;
        let rawExtent = this._rawExtent;
        let nameRepeatCount: NameRepeatCount = this._nameRepeatCount = {};
        let nameDimIdx;

        let originalChunkCount = this._chunkCount;
        for (let i = 0; i < dimLen; i++) {
            let dim = dimensions[i];
            if (!rawExtent[dim]) {
                rawExtent[dim] = getInitialExtent();
            }

            let dimInfo = dimensionInfoMap[dim];
            if (dimInfo.otherDims.itemName === 0) {
                nameDimIdx = this._nameDimIdx = i;
            }
            if (dimInfo.otherDims.itemId === 0) {
                this._idDimIdx = i;
            }

            if (!storage[dim]) {
                storage[dim] = [];
            }

            prepareChunks(storage, dimInfo, chunkSize, originalChunkCount, end);

            this._chunkCount = storage[dim].length;
        }

        let dataItem = new Array(dimLen) as OptionDataItem;
        for (let idx = start; idx < end; idx++) {
            // NOTICE: Try not to write things into dataItem
            dataItem = rawData.getItem(idx, dataItem);
            // Each data item is value
            // [1, 2]
            // 2
            // Bar chart, line chart which uses category axis
            // only gives the 'y' value. 'x' value is the indices of category
            // Use a tempValue to normalize the value to be a (x, y) value
            let chunkIndex = Math.floor(idx / chunkSize);
            let chunkOffset = idx % chunkSize;

            // Store the data by dimensions
            for (let k = 0; k < dimLen; k++) {
                let dim = dimensions[k];
                let dimStorage = storage[dim][chunkIndex];
                // PENDING NULL is empty or zero
                let val = this._dimValueGetter(dataItem, dim, idx, k) as ParsedValueNumeric;
                dimStorage[chunkOffset] = val;

                let dimRawExtent = rawExtent[dim];
                val < dimRawExtent[0] && (dimRawExtent[0] = val);
                val > dimRawExtent[1] && (dimRawExtent[1] = val);
            }

            // ??? FIXME not check by pure but sourceFormat?
            // TODO refactor these logic.
            if (!rawData.pure) {
                let name: any = nameList[idx];

                if (dataItem && name == null) {
                    // If dataItem is {name: ...}, it has highest priority.
                    // That is appropriate for many common cases.
                    if ((dataItem as any).name != null) {
                        // There is no other place to persistent dataItem.name,
                        // so save it to nameList.
                        nameList[idx] = name = (dataItem as any).name;
                    }
                    else if (nameDimIdx != null) {
                        let nameDim = dimensions[nameDimIdx];
                        let nameDimChunk = storage[nameDim][chunkIndex];
                        if (nameDimChunk) {
                            name = nameDimChunk[chunkOffset];
                            let ordinalMeta = dimensionInfoMap[nameDim].ordinalMeta;
                            if (ordinalMeta && ordinalMeta.categories.length) {
                                name = ordinalMeta.categories[name];
                            }
                        }
                    }
                }

                // Try using the id in option
                // id or name is used on dynamical data, mapping old and new items.
                let id = dataItem == null ? null : (dataItem as any).id;

                if (id == null && name != null) {
                    // Use name as id and add counter to avoid same name
                    nameRepeatCount[name] = nameRepeatCount[name] || 0;
                    id = name;
                    if (nameRepeatCount[name] > 0) {
                        id += '__ec__' + nameRepeatCount[name];
                    }
                    nameRepeatCount[name]++;
                }
                id != null && (idList[idx] = id);
            }
        }

        if (!rawData.persistent && rawData.clean) {
            // Clean unused data if data source is typed array.
            rawData.clean();
        }

        this._rawCount = this._count = end;

        // Reset data extent
        this._extent = {};

        prepareInvertedIndex(this);
    }

    count(): number {
        return this._count;
    }

    getIndices(): ArrayLike<number> {
        let newIndices;

        let indices = this._indices;
        if (indices) {
            let Ctor = indices.constructor as DataArrayLikeConstructor;
            let thisCount = this._count;
            // `new Array(a, b, c)` is different from `new Uint32Array(a, b, c)`.
            if (Ctor === Array) {
                newIndices = new Ctor(thisCount);
                for (let i = 0; i < thisCount; i++) {
                    newIndices[i] = indices[i];
                }
            }
            else {
                newIndices = new (Ctor as DataTypedArrayConstructor)(
                    (indices as DataTypedArray).buffer, 0, thisCount
                );
            }
        }
        else {
            let Ctor = getIndicesCtor(this);
            newIndices = new Ctor(this.count());
            for (let i = 0; i < newIndices.length; i++) {
                newIndices[i] = i;
            }
        }

        return newIndices;
    }

    /**
     * Get value. Return NaN if idx is out of range.
     * @param dim Dim must be concrete name.
     */
    get(dim: DimensionName, idx: number): ParsedValue {
        if (!(idx >= 0 && idx < this._count)) {
            return NaN;
        }
        let storage = this._storage;
        if (!storage[dim]) {
            // TODO Warn ?
            return NaN;
        }

        idx = this.getRawIndex(idx);

        let chunkIndex = Math.floor(idx / this._chunkSize);
        let chunkOffset = idx % this._chunkSize;

        let chunkStore = storage[dim][chunkIndex];
        let value = chunkStore[chunkOffset];
        // FIXME ordinal data type is not stackable
        // if (stack) {
        //     let dimensionInfo = this._dimensionInfos[dim];
        //     if (dimensionInfo && dimensionInfo.stackable) {
        //         let stackedOn = this.stackedOn;
        //         while (stackedOn) {
        //             // Get no stacked data of stacked on
        //             let stackedValue = stackedOn.get(dim, idx);
        //             // Considering positive stack, negative stack and empty data
        //             if ((value >= 0 && stackedValue > 0)  // Positive stack
        //                 || (value <= 0 && stackedValue < 0) // Negative stack
        //             ) {
        //                 value += stackedValue;
        //             }
        //             stackedOn = stackedOn.stackedOn;
        //         }
        //     }
        // }

        return value;
    }

    /**
     * @param dim concrete dim
     */
    getByRawIndex(dim: DimensionName, rawIdx: number): ParsedValue {
        if (!(rawIdx >= 0 && rawIdx < this._rawCount)) {
            return NaN;
        }
        let dimStore = this._storage[dim];
        if (!dimStore) {
            // TODO Warn ?
            return NaN;
        }

        let chunkIndex = Math.floor(rawIdx / this._chunkSize);
        let chunkOffset = rawIdx % this._chunkSize;
        let chunkStore = dimStore[chunkIndex];
        return chunkStore[chunkOffset];
    }

    /**
     * FIXME Use `get` on chrome maybe slow(in filterSelf and selectRange).
     * Hack a much simpler _getFast
     */
    private _getFast(dim: DimensionName, rawIdx: number): ParsedValue {
        let chunkIndex = Math.floor(rawIdx / this._chunkSize);
        let chunkOffset = rawIdx % this._chunkSize;
        let chunkStore = this._storage[dim][chunkIndex];
        return chunkStore[chunkOffset];
    }

    /**
     * Get value for multi dimensions.
     * @param dimensions If ignored, using all dimensions.
     */
    getValues(idx: number): ParsedValue[];
    getValues(dimensions: readonly DimensionName[], idx: number): ParsedValue[];
    getValues(dimensions: readonly DimensionName[] | number, idx?: number): ParsedValue[] {
        let values = [];

        if (!zrUtil.isArray(dimensions)) {
            // stack = idx;
            idx = dimensions as number;
            dimensions = this.dimensions;
        }

        for (let i = 0, len = dimensions.length; i < len; i++) {
            values.push(this.get(dimensions[i], idx /*, stack */));
        }

        return values;
    }

    /**
     * If value is NaN. Inlcuding '-'
     * Only check the coord dimensions.
     */
    hasValue(idx: number): boolean {
        let dataDimsOnCoord = this._dimensionsSummary.dataDimsOnCoord;
        for (let i = 0, len = dataDimsOnCoord.length; i < len; i++) {
            // Ordinal type originally can be string or number.
            // But when an ordinal type is used on coord, it can
            // not be string but only number. So we can also use isNaN.
            if (isNaN(this.get(dataDimsOnCoord[i], idx) as any)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Get extent of data in one dimension
     */
    getDataExtent(dim: DimensionLoose): [number, number] {
        // Make sure use concrete dim as cache name.
        dim = this.getDimension(dim);
        let dimData = this._storage[dim];
        let initialExtent = getInitialExtent();

        // stack = !!((stack || false) && this.getCalculationInfo(dim));

        if (!dimData) {
            return initialExtent;
        }

        // Make more strict checkings to ensure hitting cache.
        let currEnd = this.count();
        // let cacheName = [dim, !!stack].join('_');
        // let cacheName = dim;

        // Consider the most cases when using data zoom, `getDataExtent`
        // happened before filtering. We cache raw extent, which is not
        // necessary to be cleared and recalculated when restore data.
        let useRaw = !this._indices; // && !stack;
        let dimExtent: [number, number];

        if (useRaw) {
            return this._rawExtent[dim].slice() as [number, number];
        }
        dimExtent = this._extent[dim];
        if (dimExtent) {
            return dimExtent.slice() as [number, number];
        }
        dimExtent = initialExtent;

        let min = dimExtent[0];
        let max = dimExtent[1];

        for (let i = 0; i < currEnd; i++) {
            // let value = stack ? this.get(dim, i, true) : this._getFast(dim, this.getRawIndex(i));
            let value = this._getFast(dim, this.getRawIndex(i)) as ParsedValueNumeric;
            value < min && (min = value);
            value > max && (max = value);
        }

        dimExtent = [min, max];

        this._extent[dim] = dimExtent;

        return dimExtent;
    }

    /**
     * Optimize for the scenario that data is filtered by a given extent.
     * Consider that if data amount is more than hundreds of thousand,
     * extent calculation will cost more than 10ms and the cache will
     * be erased because of the filtering.
     */
    getApproximateExtent(dim: DimensionLoose): [number, number] {
        dim = this.getDimension(dim);
        return this._approximateExtent[dim] || this.getDataExtent(dim /*, stack */);
    }

    setApproximateExtent(extent: [number, number], dim: DimensionLoose): void {
        dim = this.getDimension(dim);
        this._approximateExtent[dim] = extent.slice() as [number, number];
    }

    getCalculationInfo(key: string): any {
        return this._calculationInfo[key];
    }

    /**
     * @param key or k-v object
     */
    setCalculationInfo(key: string | object, value?: any) {
        isObject(key)
            ? zrUtil.extend(this._calculationInfo, key as object)
            : (this._calculationInfo[key] = value);
    }

    /**
     * Get sum of data in one dimension
     */
    getSum(dim: DimensionName): number {
        let dimData = this._storage[dim];
        let sum = 0;
        if (dimData) {
            for (let i = 0, len = this.count(); i < len; i++) {
                let value = this.get(dim, i) as number;
                if (!isNaN(value)) {
                    sum += value;
                }
            }
        }
        return sum;
    }

    /**
     * Get median of data in one dimension
     */
    getMedian(dim: DimensionLoose): number {
        let dimDataArray: ParsedValue[] = [];
        // map all data of one dimension
        this.each(dim, function (val) {
            if (!isNaN(val as number)) {
                dimDataArray.push(val);
            }
        });

        // TODO
        // Use quick select?
        let sortedDimDataArray = dimDataArray.sort(function (a: number, b: number) {
            return a - b;
        }) as number[];
        let len = this.count();
        // calculate median
        return len === 0
            ? 0
            : len % 2 === 1
            ? sortedDimDataArray[(len - 1) / 2]
            : (sortedDimDataArray[len / 2] + sortedDimDataArray[len / 2 - 1]) / 2;
    }

    // /**
    //  * Retreive the index with given value
    //  * @param {string} dim Concrete dimension.
    //  * @param {number} value
    //  * @return {number}
    //  */
    // Currently incorrect: should return dataIndex but not rawIndex.
    // Do not fix it until this method is to be used somewhere.
    // FIXME Precision of float value
    // indexOf(dim, value) {
    //     let storage = this._storage;
    //     let dimData = storage[dim];
    //     let chunkSize = this._chunkSize;
    //     if (dimData) {
    //         for (let i = 0, len = this.count(); i < len; i++) {
    //             let chunkIndex = Math.floor(i / chunkSize);
    //             let chunkOffset = i % chunkSize;
    //             if (dimData[chunkIndex][chunkOffset] === value) {
    //                 return i;
    //             }
    //         }
    //     }
    //     return -1;
    // }

    /**
     * Only support the dimension which inverted index created.
     * Do not support other cases until required.
     * @param dim concrete dim
     * @param value ordinal index
     * @return rawIndex
     */
    rawIndexOf(dim: DimensionName, value: OrdinalNumber): number {
        let invertedIndices = dim && this._invertedIndicesMap[dim];
        if (__DEV__) {
            if (!invertedIndices) {
                throw new Error('Do not supported yet');
            }
        }
        let rawIndex = invertedIndices[value];
        if (rawIndex == null || isNaN(rawIndex)) {
            return INDEX_NOT_FOUND;
        }
        return rawIndex;
    }

    /**
     * Retreive the index with given name
     */
    indexOfName(name: string): number {
        for (let i = 0, len = this.count(); i < len; i++) {
            if (this.getName(i) === name) {
                return i;
            }
        }

        return -1;
    }

    /**
     * Retreive the index with given raw data index
     */
    indexOfRawIndex(rawIndex: number): number {
        if (rawIndex >= this._rawCount || rawIndex < 0) {
            return -1;
        }

        if (!this._indices) {
            return rawIndex;
        }

        // Indices are ascending
        let indices = this._indices;

        // If rawIndex === dataIndex
        let rawDataIndex = indices[rawIndex];
        if (rawDataIndex != null && rawDataIndex < this._count && rawDataIndex === rawIndex) {
            return rawIndex;
        }

        let left = 0;
        let right = this._count - 1;
        while (left <= right) {
            let mid = (left + right) / 2 | 0;
            if (indices[mid] < rawIndex) {
                left = mid + 1;
            }
            else if (indices[mid] > rawIndex) {
                right = mid - 1;
            }
            else {
                return mid;
            }
        }
        return -1;
    }

    /**
     * Retreive the index of nearest value
     * @param dim
     * @param value
     * @param [maxDistance=Infinity]
     * @return If and only if multiple indices has
     *         the same value, they are put to the result.
     */
    indicesOfNearest(
        dim: DimensionName, value: number, maxDistance?: number
    ): number[] {
        let storage = this._storage;
        let dimData = storage[dim];
        let nearestIndices: number[] = [];

        if (!dimData) {
            return nearestIndices;
        }

        if (maxDistance == null) {
            maxDistance = Infinity;
        }

        let minDist = Infinity;
        let minDiff = -1;
        let nearestIndicesLen = 0;

        // Check the test case of `test/ut/spec/data/List.js`.
        for (let i = 0, len = this.count(); i < len; i++) {
            let diff = value - (this.get(dim, i) as number);
            let dist = Math.abs(diff);
            if (dist <= maxDistance) {
                // When the `value` is at the middle of `this.get(dim, i)` and `this.get(dim, i+1)`,
                // we'd better not push both of them to `nearestIndices`, otherwise it is easy to
                // get more than one item in `nearestIndices` (more specifically, in `tooltip`).
                // So we chose the one that `diff >= 0` in this csae.
                // But if `this.get(dim, i)` and `this.get(dim, j)` get the same value, both of them
                // should be push to `nearestIndices`.
                if (dist < minDist
                    || (dist === minDist && diff >= 0 && minDiff < 0)
                ) {
                    minDist = dist;
                    minDiff = diff;
                    nearestIndicesLen = 0;
                }
                if (diff === minDiff) {
                    nearestIndices[nearestIndicesLen++] = i;
                }
            }
        }
        nearestIndices.length = nearestIndicesLen;

        return nearestIndices;
    }

    /**
     * Get raw data index.
     * Do not initialize.
     * Default `getRawIndex`. And it can be changed.
     */
    getRawIndex: (idx: number) => number = getRawIndexWithoutIndices;

    /**
     * Get raw data item
     */
    getRawDataItem(idx: number): OptionDataItem {
        if (!this._rawData.persistent) {
            let val = [];
            for (let i = 0; i < this.dimensions.length; i++) {
                let dim = this.dimensions[i];
                val.push(this.get(dim, idx));
            }
            return val;
        }
        else {
            return this._rawData.getItem(this.getRawIndex(idx));
        }
    }

    getName(idx: number): string {
        let rawIndex = this.getRawIndex(idx);
        return this._nameList[rawIndex]
            || getRawValueFromStore(this, this._nameDimIdx, rawIndex)
            || '';
    }

    getId(idx: number): string {
        return getId(this, this.getRawIndex(idx));
    }

    /**
     * Data iteration
     * @param ctx default this
     * @example
     *  list.each('x', function (x, idx) {});
     *  list.each(['x', 'y'], function (x, y, idx) {});
     *  list.each(function (idx) {})
     */
    each<Ctx>(cb: EachCb0<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): void;
    each<Ctx>(dims: DimensionLoose, cb: EachCb1<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): void;
    each<Ctx>(dims: [DimensionLoose], cb: EachCb1<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): void;
    each<Ctx>(dims: [DimensionLoose, DimensionLoose], cb: EachCb2<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): void;
    each<Ctx>(dims: ItrParamDims, cb: EachCb<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): void;
    each<Ctx>(
        dims: ItrParamDims | EachCb<Ctx>,
        cb: EachCb<Ctx> | Ctx,
        ctx?: Ctx,
        ctxCompat?: Ctx
    ): void {
        'use strict';

        if (!this._count) {
            return;
        }

        if (typeof dims === 'function') {
            ctxCompat = ctx;
            ctx = cb as Ctx;
            cb = dims;
            dims = [];
        }

        // ctxCompat just for compat echarts3
        let fCtx = (ctx || ctxCompat || this) as CtxOrList<Ctx>;

        let dimNames = zrUtil.map(normalizeDimensions(dims), this.getDimension, this);

        if (__DEV__) {
            validateDimensions(this, dimNames);
        }

        let dimSize = dimNames.length;

        for (let i = 0; i < this.count(); i++) {
            // Simple optimization
            switch (dimSize) {
                case 0:
                    (cb as EachCb0<Ctx>).call(fCtx, i);
                    break;
                case 1:
                    (cb as EachCb1<Ctx>).call(fCtx, this.get(dimNames[0], i), i);
                    break;
                case 2:
                    (cb as EachCb2<Ctx>).call(fCtx, this.get(dimNames[0], i), this.get(dimNames[1], i), i);
                    break;
                default:
                    let k = 0;
                    let value = [];
                    for (; k < dimSize; k++) {
                        value[k] = this.get(dimNames[k], i);
                    }
                    // Index
                    value[k] = i;
                    (cb as EachCb<Ctx>).apply(fCtx, value);
            }
        }
    }

    /**
     * Data filter
     */
    filterSelf<Ctx>(cb: FilterCb0<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): this;
    filterSelf<Ctx>(dims: DimensionLoose, cb: FilterCb1<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): this;
    filterSelf<Ctx>(dims: [DimensionLoose], cb: FilterCb1<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): this;
    filterSelf<Ctx>(dims: [DimensionLoose, DimensionLoose], cb: FilterCb2<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): this;
    filterSelf<Ctx>(dims: ItrParamDims, cb: FilterCb<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): this;
    filterSelf<Ctx>(
        dims: ItrParamDims | FilterCb<Ctx>,
        cb: FilterCb<Ctx> | Ctx,
        ctx?: Ctx,
        ctxCompat?: Ctx
    ): List {
        'use strict';

        if (!this._count) {
            return;
        }

        if (typeof dims === 'function') {
            ctxCompat = ctx;
            ctx = cb as Ctx;
            cb = dims;
            dims = [];
        }

        // ctxCompat just for compat echarts3
        let fCtx = (ctx || ctxCompat || this) as CtxOrList<Ctx>;

        let dimNames = zrUtil.map(
            normalizeDimensions(dims), this.getDimension, this
        );

        if (__DEV__) {
            validateDimensions(this, dimNames);
        }


        let count = this.count();
        let Ctor = getIndicesCtor(this);
        let newIndices = new Ctor(count);
        let value = [];
        let dimSize = dimNames.length;

        let offset = 0;
        let dim0 = dimNames[0];

        for (let i = 0; i < count; i++) {
            let keep;
            let rawIdx = this.getRawIndex(i);
            // Simple optimization
            if (dimSize === 0) {
                keep = (cb as FilterCb0<Ctx>).call(fCtx, i);
            }
            else if (dimSize === 1) {
                let val = this._getFast(dim0, rawIdx);
                keep = (cb as FilterCb1<Ctx>).call(fCtx, val, i);
            }
            else {
                let k = 0;
                for (; k < dimSize; k++) {
                    value[k] = this._getFast(dim0, rawIdx);
                }
                value[k] = i;
                keep = (cb as FilterCb<Ctx>).apply(fCtx, value);
            }
            if (keep) {
                newIndices[offset++] = rawIdx;
            }
        }

        // Set indices after filtered.
        if (offset < count) {
            this._indices = newIndices;
        }
        this._count = offset;
        // Reset data extent
        this._extent = {};

        this.getRawIndex = this._indices ? getRawIndexWithIndices : getRawIndexWithoutIndices;

        return this;
    }

    /**
     * Select data in range. (For optimization of filter)
     * (Manually inline code, support 5 million data filtering in data zoom.)
     */
    selectRange(range: {[dimName: string]: [number, number]}): List {
        'use strict';

        if (!this._count) {
            return;
        }

        let dimensions = [];
        for (let dim in range) {
            if (range.hasOwnProperty(dim)) {
                dimensions.push(dim);
            }
        }

        if (__DEV__) {
            validateDimensions(this, dimensions);
        }

        let dimSize = dimensions.length;
        if (!dimSize) {
            return;
        }

        let originalCount = this.count();
        let Ctor = getIndicesCtor(this);
        let newIndices = new Ctor(originalCount);

        let offset = 0;
        let dim0 = dimensions[0];

        let min = range[dim0][0];
        let max = range[dim0][1];

        let quickFinished = false;
        if (!this._indices) {
            // Extreme optimization for common case. About 2x faster in chrome.
            let idx = 0;
            if (dimSize === 1) {
                let dimStorage = this._storage[dimensions[0]];
                for (let k = 0; k < this._chunkCount; k++) {
                    let chunkStorage = dimStorage[k];
                    let len = Math.min(this._count - k * this._chunkSize, this._chunkSize);
                    for (let i = 0; i < len; i++) {
                        let val = chunkStorage[i];
                        // NaN will not be filtered. Consider the case, in line chart, empty
                        // value indicates the line should be broken. But for the case like
                        // scatter plot, a data item with empty value will not be rendered,
                        // but the axis extent may be effected if some other dim of the data
                        // item has value. Fortunately it is not a significant negative effect.
                        if (
                            (val >= min && val <= max) || isNaN(val as any)
                        ) {
                            newIndices[offset++] = idx;
                        }
                        idx++;
                    }
                }
                quickFinished = true;
            }
            else if (dimSize === 2) {
                let dimStorage = this._storage[dim0];
                let dimStorage2 = this._storage[dimensions[1]];
                let min2 = range[dimensions[1]][0];
                let max2 = range[dimensions[1]][1];
                for (let k = 0; k < this._chunkCount; k++) {
                    let chunkStorage = dimStorage[k];
                    let chunkStorage2 = dimStorage2[k];
                    let len = Math.min(this._count - k * this._chunkSize, this._chunkSize);
                    for (let i = 0; i < len; i++) {
                        let val = chunkStorage[i];
                        let val2 = chunkStorage2[i];
                        // Do not filter NaN, see comment above.
                        if ((
                                (val >= min && val <= max) || isNaN(val as any)
                            )
                            && (
                                (val2 >= min2 && val2 <= max2) || isNaN(val2 as any)
                            )
                        ) {
                            newIndices[offset++] = idx;
                        }
                        idx++;
                    }
                }
                quickFinished = true;
            }
        }
        if (!quickFinished) {
            if (dimSize === 1) {
                for (let i = 0; i < originalCount; i++) {
                    let rawIndex = this.getRawIndex(i);
                    let val = this._getFast(dim0, rawIndex);
                    // Do not filter NaN, see comment above.
                    if (
                        (val >= min && val <= max) || isNaN(val as any)
                    ) {
                        newIndices[offset++] = rawIndex;
                    }
                }
            }
            else {
                for (let i = 0; i < originalCount; i++) {
                    let keep = true;
                    let rawIndex = this.getRawIndex(i);
                    for (let k = 0; k < dimSize; k++) {
                        let dimk = dimensions[k];
                        let val = this._getFast(dimk, rawIndex);
                        // Do not filter NaN, see comment above.
                        if (val < range[dimk][0] || val > range[dimk][1]) {
                            keep = false;
                        }
                    }
                    if (keep) {
                        newIndices[offset++] = this.getRawIndex(i);
                    }
                }
            }
        }

        // Set indices after filtered.
        if (offset < originalCount) {
            this._indices = newIndices;
        }
        this._count = offset;
        // Reset data extent
        this._extent = {};

        this.getRawIndex = this._indices ? getRawIndexWithIndices : getRawIndexWithoutIndices;

        return this;
    }

    /**
     * Data mapping to a plain array
     */
    mapArray<Ctx, Cb extends MapArrayCb0<Ctx>>(cb: Cb, ctx?: Ctx, ctxCompat?: Ctx): ReturnType<Cb>[];
    /* eslint-disable */
    mapArray<Ctx, Cb extends MapArrayCb1<Ctx>>(dims: DimensionLoose, cb: Cb, ctx?: Ctx, ctxCompat?: Ctx): ReturnType<Cb>[];
    mapArray<Ctx, Cb extends MapArrayCb1<Ctx>>(dims: [DimensionLoose], cb: Cb, ctx?: Ctx, ctxCompat?: Ctx): ReturnType<Cb>[];
    mapArray<Ctx, Cb extends MapArrayCb2<Ctx>>(dims: [DimensionLoose, DimensionLoose], cb: Cb, ctx?: Ctx, ctxCompat?: Ctx): ReturnType<Cb>[];
    mapArray<Ctx, Cb extends MapArrayCb<Ctx>>(dims: ItrParamDims, cb: Cb, ctx?: Ctx, ctxCompat?: Ctx): ReturnType<Cb>[];
    /* eslint-enable */
    mapArray<Ctx>(
        dims: ItrParamDims | MapArrayCb<Ctx>,
        cb: MapArrayCb<Ctx> | Ctx,
        ctx?: Ctx,
        ctxCompat?: Ctx
    ): any[] {
        'use strict';

        if (typeof dims === 'function') {
            ctxCompat = ctx;
            ctx = cb as Ctx;
            cb = dims;
            dims = [];
        }

        // ctxCompat just for compat echarts3
        ctx = (ctx || ctxCompat || this) as Ctx;

        let result: any[] = [];
        this.each(dims, function () {
            result.push(cb && (cb as MapArrayCb<Ctx>).apply(this, arguments));
        }, ctx);
        return result;
    }

    /**
     * Data mapping to a new List with given dimensions
     */
    map<Ctx>(dims: DimensionLoose, cb: MapCb1<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): List<HostModel>;
    map<Ctx>(dims: [DimensionLoose], cb: MapCb1<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): List<HostModel>;
    map<Ctx>(dims: [DimensionLoose, DimensionLoose], cb: MapCb2<Ctx>, ctx?: Ctx, ctxCompat?: Ctx): List<HostModel>;
    map<Ctx>(
        dims: ItrParamDims,
        cb: MapCb<Ctx>,
        ctx?: Ctx,
        ctxCompat?: Ctx
    ): List {
        'use strict';

        // ctxCompat just for compat echarts3
        let fCtx = (ctx || ctxCompat || this) as CtxOrList<Ctx>;

        let dimNames = zrUtil.map(
            normalizeDimensions(dims), this.getDimension, this
        );

        if (__DEV__) {
            validateDimensions(this, dimNames);
        }

        let list = cloneListForMapAndSample(this, dimNames);

        // Following properties are all immutable.
        // So we can reference to the same value
        list._indices = this._indices;
        list.getRawIndex = list._indices ? getRawIndexWithIndices : getRawIndexWithoutIndices;

        let storage = list._storage;

        let tmpRetValue = [];
        let chunkSize = this._chunkSize;
        let dimSize = dimNames.length;
        let dataCount = this.count();
        let values = [];
        let rawExtent = list._rawExtent;

        for (let dataIndex = 0; dataIndex < dataCount; dataIndex++) {
            for (let dimIndex = 0; dimIndex < dimSize; dimIndex++) {
                values[dimIndex] = this.get(dimNames[dimIndex], dataIndex);
            }
            values[dimSize] = dataIndex;

            let retValue = cb && cb.apply(fCtx, values);
            if (retValue != null) {
                // a number or string (in oridinal dimension)?
                if (typeof retValue !== 'object') {
                    tmpRetValue[0] = retValue;
                    retValue = tmpRetValue;
                }

                let rawIndex = this.getRawIndex(dataIndex);
                let chunkIndex = Math.floor(rawIndex / chunkSize);
                let chunkOffset = rawIndex % chunkSize;

                for (let i = 0; i < retValue.length; i++) {
                    let dim = dimNames[i];
                    let val = retValue[i];
                    let rawExtentOnDim = rawExtent[dim];

                    let dimStore = storage[dim];
                    if (dimStore) {
                        dimStore[chunkIndex][chunkOffset] = val;
                    }

                    if (val < rawExtentOnDim[0]) {
                        rawExtentOnDim[0] = val as number;
                    }
                    if (val > rawExtentOnDim[1]) {
                        rawExtentOnDim[1] = val as number;
                    }
                }
            }
        }

        return list;
    }

    /**
     * Large data down sampling on given dimension
     * @param sampleIndex Sample index for name and id
     */
    downSample(
        dimension: DimensionName,
        rate: number,
        sampleValue: (frameValues: ArrayLike<ParsedValue>) => ParsedValueNumeric,
        sampleIndex: (frameValues: ArrayLike<ParsedValue>, value: ParsedValueNumeric) => number
    ): List<HostModel> {
        let list = cloneListForMapAndSample(this, [dimension]);
        let targetStorage = list._storage;

        let frameValues = [];
        let frameSize = Math.floor(1 / rate);

        let dimStore = targetStorage[dimension];
        let len = this.count();
        let chunkSize = this._chunkSize;
        let rawExtentOnDim = list._rawExtent[dimension];

        let newIndices = new (getIndicesCtor(this))(len);

        let offset = 0;
        for (let i = 0; i < len; i += frameSize) {
            // Last frame
            if (frameSize > len - i) {
                frameSize = len - i;
                frameValues.length = frameSize;
            }
            for (let k = 0; k < frameSize; k++) {
                let dataIdx = this.getRawIndex(i + k);
                let originalChunkIndex = Math.floor(dataIdx / chunkSize);
                let originalChunkOffset = dataIdx % chunkSize;
                frameValues[k] = dimStore[originalChunkIndex][originalChunkOffset];
            }
            let value = sampleValue(frameValues);
            let sampleFrameIdx = this.getRawIndex(
                Math.min(i + sampleIndex(frameValues, value) || 0, len - 1)
            );
            let sampleChunkIndex = Math.floor(sampleFrameIdx / chunkSize);
            let sampleChunkOffset = sampleFrameIdx % chunkSize;
            // Only write value on the filtered data
            dimStore[sampleChunkIndex][sampleChunkOffset] = value;

            if (value < rawExtentOnDim[0]) {
                rawExtentOnDim[0] = value;
            }
            if (value > rawExtentOnDim[1]) {
                rawExtentOnDim[1] = value;
            }

            newIndices[offset++] = sampleFrameIdx;
        }

        list._count = offset;
        list._indices = newIndices;

        list.getRawIndex = getRawIndexWithIndices;

        return list as List<HostModel>;
    }

    /**
     * Get model of one data item.
     */
    // TODO: Type of data item
    getItemModel<ItemOpts extends unknown = unknown>(idx: number): Model<ItemOpts
        // Extract item option with value key. FIXME will cause incompatitable issue
        // Extract<HostModel['option']['data'][number], { value?: any }>
    > {
        let hostModel = this.hostModel;
        let dataItem = this.getRawDataItem(idx) as ModelOption;
        return new Model(dataItem, hostModel, hostModel && hostModel.ecModel);
    }

    /**
     * Create a data differ
     */
    diff(otherList: List): DataDiffer {
        let thisList = this;

        return new DataDiffer(
            otherList ? otherList.getIndices() : [],
            this.getIndices(),
            function (idx) {
                return getId(otherList, idx);
            },
            function (idx) {
                return getId(thisList, idx);
            }
        );
    }

    /**
     * Get visual property.
     */
    getVisual(key: string): any {
        let visual = this._visual;
        return visual && visual[key];
    }

    /**
     * Set visual property
     *
     * @example
     *  setVisual('color', color);
     *  setVisual({
     *      'color': color
     *  });
     */
    setVisual(key: string, val: any): void;
    setVisual(kvObj: Dictionary<any>): void;
    setVisual(key: string | Dictionary<any>, val?: any): void {
        if (isObject(key)) {
            for (let name in key) {
                if (key.hasOwnProperty(name)) {
                    this.setVisual(name, key[name]);
                }
            }
            return;
        }
        this._visual = this._visual || {};
        this._visual[key] = val;
    }

    /**
     * Set layout property.
     */
    setLayout(key: string, val: any): void;
    setLayout(kvObj: Dictionary<any>): void;
    setLayout(key: string | Dictionary<any>, val?: any): void {
        if (isObject(key)) {
            for (let name in key) {
                if (key.hasOwnProperty(name)) {
                    this.setLayout(name, key[name]);
                }
            }
            return;
        }
        this._layout[key] = val;
    }

    /**
     * Get layout property.
     */
    getLayout(key: string): any {
        return this._layout[key];
    }

    /**
     * Get layout of single data item
     */
    getItemLayout(idx: number): any {
        return this._itemLayouts[idx];
    }

    /**
     * Set layout of single data item
     */
    setItemLayout<M = false>(
        idx: number,
        layout: (M extends true ? Dictionary<any> : any),
        merge?: M
    ): void {
        this._itemLayouts[idx] = merge
            ? zrUtil.extend(this._itemLayouts[idx] || {}, layout)
            : layout;
    }

    /**
     * Clear all layout of single data item
     */
    clearItemLayouts(): void {
        this._itemLayouts.length = 0;
    }

    /**
     * Get visual property of single data item
     */
    getItemVisual(idx: number, key: string, ignoreParent?: boolean): any {
        let itemVisual = this._itemVisuals[idx];
        let val = itemVisual && itemVisual[key];
        if (val == null && !ignoreParent) {
            // Use global visual property
            return this.getVisual(key);
        }
        return val;
    }

    /**
     * Set visual property of single data item
     *
     * @param {number} idx
     * @param {string|Object} key
     * @param {*} [value]
     *
     * @example
     *  setItemVisual(0, 'color', color);
     *  setItemVisual(0, {
     *      'color': color
     *  });
     */
    setItemVisual(idx: number, key: string, value: any): void;
    setItemVisual(idx: number, kvObject: Dictionary<any>): void;
    setItemVisual(idx: number, key: string | Dictionary<any>, value?: any): void {
        let itemVisual = this._itemVisuals[idx] || {};
        let hasItemVisual = this.hasItemVisual;
        this._itemVisuals[idx] = itemVisual;

        if (isObject(key)) {
            for (let name in key) {
                if (key.hasOwnProperty(name)) {
                    itemVisual[name] = key[name];
                    hasItemVisual[name] = true;
                }
            }
            return;
        }
        itemVisual[key] = value;
        hasItemVisual[key] = true;
    }

    /**
     * Clear itemVisuals and list visual.
     */
    clearAllVisual(): void {
        this._visual = {};
        this._itemVisuals = [];
        this.hasItemVisual = {};
    }

    /**
     * Set graphic element relative to data. It can be set as null
     */
    setItemGraphicEl(idx: number, el: Element): void {
        let hostModel = this.hostModel;

        if (el) {
            let ecData = getECData(el);
            // Add data index and series index for indexing the data by element
            // Useful in tooltip
            ecData.dataIndex = idx;
            ecData.dataType = this.dataType;
            ecData.seriesIndex = hostModel && (hostModel as any).seriesIndex;
            if (el.type === 'group') {
                el.traverse(setItemDataAndSeriesIndex, el);
            }
        }

        this._graphicEls[idx] = el;
    }

    getItemGraphicEl(idx: number): Element {
        return this._graphicEls[idx];
    }

    eachItemGraphicEl<Ctx = unknown>(
        cb: (this: Ctx, el: Element, idx: number) => void,
        context?: Ctx
    ): void {
        zrUtil.each(this._graphicEls, function (el, idx) {
            if (el) {
                cb && cb.call(context, el, idx);
            }
        });
    }

    /**
     * Shallow clone a new list except visual and layout properties, and graph elements.
     * New list only change the indices.
     */
    cloneShallow(list?: List<HostModel>): List<HostModel> {
        if (!list) {
            let dimensionInfoList = zrUtil.map(this.dimensions, this.getDimensionInfo, this);
            list = new List(dimensionInfoList, this.hostModel);
        }

        // FIXME
        list._storage = this._storage;

        transferProperties(list, this);

        // Clone will not change the data extent and indices
        if (this._indices) {
            let Ctor = this._indices.constructor as DataArrayLikeConstructor;
            if (Ctor === Array) {
                let thisCount = this._indices.length;
                list._indices = new Ctor(thisCount);
                for (let i = 0; i < thisCount; i++) {
                    list._indices[i] = this._indices[i];
                }
            }
            else {
                list._indices = new (Ctor as DataTypedArrayConstructor)(this._indices);
            }
        }
        else {
            list._indices = null;
        }
        list.getRawIndex = list._indices ? getRawIndexWithIndices : getRawIndexWithoutIndices;

        return list;
    }

    /**
     * Wrap some method to add more feature
     */
    wrapMethod(
        methodName: FunctionPropertyNames<List>,
        injectFunction: (...args: any) => any
    ): void {
        let originalMethod = this[methodName];
        if (typeof originalMethod !== 'function') {
            return;
        }
        this.__wrappedMethods = this.__wrappedMethods || [];
        this.__wrappedMethods.push(methodName);
        this[methodName] = function () {
            let res = (originalMethod as any).apply(this, arguments);
            return injectFunction.apply(this, [res].concat(zrUtil.slice(arguments)));
        };
    }


    // ----------------------------------------------------------
    // A work around for internal method visiting private member.
    // ----------------------------------------------------------
    private static internalField = (function () {

        defaultDimValueGetters = {

            arrayRows: getDimValueSimply,

            objectRows: function (
                this: List, dataItem: Dictionary<any>, dimName: string, dataIndex: number, dimIndex: number
            ): ParsedValue {
                return convertDataValue(dataItem[dimName], this._dimensionInfos[dimName]);
            },

            keyedColumns: getDimValueSimply,

            original: function (
                this: List, dataItem: any, dimName: string, dataIndex: number, dimIndex: number
            ): ParsedValue {
                // Performance sensitive, do not use modelUtil.getDataItemValue.
                // If dataItem is an plain object with no value field, the let `value`
                // will be assigned with the object, but it will be tread correctly
                // in the `convertDataValue`.
                let value = dataItem && (dataItem.value == null ? dataItem : dataItem.value);

                // If any dataItem is like { value: 10 }
                if (!this._rawData.pure && isDataItemOption(dataItem)) {
                    this.hasItemOption = true;
                }
                return convertDataValue(
                    (value instanceof Array)
                        ? value[dimIndex]
                        // If value is a single number or something else not array.
                        : value,
                    this._dimensionInfos[dimName]
                );
            },

            typedArray: function (
                this: List, dataItem: any, dimName: string, dataIndex: number, dimIndex: number
            ): ParsedValue {
                return dataItem[dimIndex];
            }

        };

        function getDimValueSimply(
            this: List, dataItem: any, dimName: string, dataIndex: number, dimIndex: number
        ): ParsedValue {
            return convertDataValue(dataItem[dimIndex], this._dimensionInfos[dimName]);
        }

        /**
         * Convert raw the value in to inner value in List.
         * [Caution]: this is the key logic of user value parser.
         * For backward compatibiliy, do not modify it until have to.
         */
        function convertDataValue(value: any, dimInfo: DataDimensionInfo): ParsedValue {
            // Performance sensitive.
            let dimType = dimInfo && dimInfo.type;
            if (dimType === 'ordinal') {
                // If given value is a category string
                let ordinalMeta = dimInfo && dimInfo.ordinalMeta;
                return ordinalMeta
                    ? ordinalMeta.parseAndCollect(value)
                    : value;
            }

            if (dimType === 'time'
                // spead up when using timestamp
                && typeof value !== 'number'
                && value != null
                && value !== '-'
            ) {
                value = +parseDate(value);
            }

            // dimType defaults 'number'.
            // If dimType is not ordinal and value is null or undefined or NaN or '-',
            // parse to NaN.
            return (value == null || value === '')
                ? NaN
                // If string (like '-'), using '+' parse to NaN
                // If object, also parse to NaN
                : +value;
        };

        prepareInvertedIndex = function (list: List): void {
            let invertedIndicesMap = list._invertedIndicesMap;
            zrUtil.each(invertedIndicesMap, function (invertedIndices, dim) {
                let dimInfo = list._dimensionInfos[dim];

                // Currently, only dimensions that has ordinalMeta can create inverted indices.
                let ordinalMeta = dimInfo.ordinalMeta;
                if (ordinalMeta) {
                    invertedIndices = invertedIndicesMap[dim] = new CtorInt32Array(
                        ordinalMeta.categories.length
                    );
                    // The default value of TypedArray is 0. To avoid miss
                    // mapping to 0, we should set it as INDEX_NOT_FOUND.
                    for (let i = 0; i < invertedIndices.length; i++) {
                        invertedIndices[i] = INDEX_NOT_FOUND;
                    }
                    for (let i = 0; i < list._count; i++) {
                        // Only support the case that all values are distinct.
                        invertedIndices[list.get(dim, i) as number] = i;
                    }
                }
            });
        };

        getRawValueFromStore = function (list: List, dimIndex: number, rawIndex: number): any {
            let val;
            if (dimIndex != null) {
                let chunkSize = list._chunkSize;
                let chunkIndex = Math.floor(rawIndex / chunkSize);
                let chunkOffset = rawIndex % chunkSize;
                let dim = list.dimensions[dimIndex];
                let chunk = list._storage[dim][chunkIndex];
                if (chunk) {
                    val = chunk[chunkOffset];
                    let ordinalMeta = list._dimensionInfos[dim].ordinalMeta;
                    if (ordinalMeta && ordinalMeta.categories.length) {
                        val = ordinalMeta.categories[val as OrdinalNumber];
                    }
                }
            }
            return val;
        };

        getIndicesCtor = function (list: List): DataArrayLikeConstructor {
            // The possible max value in this._indicies is always this._rawCount despite of filtering.
            return list._rawCount > 65535 ? CtorUint32Array : CtorUint16Array;
        };

        prepareChunks = function (
            storage: DataStorage,
            dimInfo: DataDimensionInfo,
            chunkSize: number,
            chunkCount: number,
            end: number
        ): void {
            let DataCtor = dataCtors[dimInfo.type];
            let lastChunkIndex = chunkCount - 1;
            let dim = dimInfo.name;
            let resizeChunkArray = storage[dim][lastChunkIndex];
            if (resizeChunkArray && resizeChunkArray.length < chunkSize) {
                let newStore = new DataCtor(Math.min(end - lastChunkIndex * chunkSize, chunkSize));
                // The cost of the copy is probably inconsiderable
                // within the initial chunkSize.
                for (let j = 0; j < resizeChunkArray.length; j++) {
                    newStore[j] = resizeChunkArray[j];
                }
                storage[dim][lastChunkIndex] = newStore;
            }

            // Create new chunks.
            for (let k = chunkCount * chunkSize; k < end; k += chunkSize) {
                storage[dim].push(new DataCtor(Math.min(end - k, chunkSize)));
            }
        };

        getRawIndexWithoutIndices = function (this: List, idx: number): number {
            return idx;
        };

        getRawIndexWithIndices = function (this: List, idx: number): number {
            if (idx < this._count && idx >= 0) {
                return this._indices[idx];
            }
            return -1;
        };

        getId = function (list: List, rawIndex: number): string {
            let id = list._idList[rawIndex];
            if (id == null) {
                id = getRawValueFromStore(list, list._idDimIdx, rawIndex);
            }
            if (id == null) {
                // FIXME Check the usage in graph, should not use prefix.
                id = ID_PREFIX + rawIndex;
            }
            return id;
        };

        normalizeDimensions = function (
            dimensions: ItrParamDims
        ): Array<DimensionLoose> {
            if (!zrUtil.isArray(dimensions)) {
                dimensions = [dimensions];
            }
            return dimensions;
        };

        validateDimensions = function (list: List, dims: DimensionName[]): void {
            for (let i = 0; i < dims.length; i++) {
                // stroage may be empty when no data, so use
                // dimensionInfos to check.
                if (!list._dimensionInfos[dims[i]]) {
                    console.error('Unkown dimension ' + dims[i]);
                }
            }
        };

        // Data in excludeDimensions is copied, otherwise transfered.
        cloneListForMapAndSample = function (
            original: List, excludeDimensions: DimensionName[]
        ): List {
            let allDimensions = original.dimensions;
            let list = new List(
                zrUtil.map(allDimensions, original.getDimensionInfo, original),
                original.hostModel
            );
            // FIXME If needs stackedOn, value may already been stacked
            transferProperties(list, original);

            let storage = list._storage = {} as DataStorage;
            let originalStorage = original._storage;

            // Init storage
            for (let i = 0; i < allDimensions.length; i++) {
                let dim = allDimensions[i];
                if (originalStorage[dim]) {
                    // Notice that we do not reset invertedIndicesMap here, becuase
                    // there is no scenario of mapping or sampling ordinal dimension.
                    if (zrUtil.indexOf(excludeDimensions, dim) >= 0) {
                        storage[dim] = cloneDimStore(originalStorage[dim]);
                        list._rawExtent[dim] = getInitialExtent();
                        list._extent[dim] = null;
                    }
                    else {
                        // Direct reference for other dimensions
                        storage[dim] = originalStorage[dim];
                    }
                }
            }
            return list;
        };

        cloneDimStore = function (originalDimStore: DataValueChunk[]): DataValueChunk[] {
            let newDimStore = new Array(originalDimStore.length);
            for (let j = 0; j < originalDimStore.length; j++) {
                newDimStore[j] = cloneChunk(originalDimStore[j]);
            }
            return newDimStore;
        };

        function cloneChunk(originalChunk: DataValueChunk): DataValueChunk {
            let Ctor = originalChunk.constructor;
            // Only shallow clone is enough when Array.
            return Ctor === Array
                ? (originalChunk as Array<ParsedValue>).slice()
                : new (Ctor as DataTypedArrayConstructor)(originalChunk as DataTypedArray);
        }

        getInitialExtent = function (): [number, number] {
            return [Infinity, -Infinity];
        };

        setItemDataAndSeriesIndex = function (this: Element, child: Element): void {
            let childECData = getECData(child);
            let thisECData = getECData(this);
            childECData.seriesIndex = thisECData.seriesIndex;
            childECData.dataIndex = thisECData.dataIndex;
            childECData.dataType = thisECData.dataType;
        };

        transferProperties = function (target: List, source: List): void {
            zrUtil.each(
                TRANSFERABLE_PROPERTIES.concat(source.__wrappedMethods || []),
                function (propName) {
                    if (source.hasOwnProperty(propName)) {
                        (target as any)[propName] = (source as any)[propName];
                    }
                }
            );

            target.__wrappedMethods = source.__wrappedMethods;

            zrUtil.each(CLONE_PROPERTIES, function (propName) {
                (target as any)[propName] = zrUtil.clone((source as any)[propName]);
            });

            target._calculationInfo = zrUtil.extend({}, source._calculationInfo);
        };

    })();

}

// -----------------------------
// Internal method declarations:
// -----------------------------
let defaultDimValueGetters: {[sourceFormat: string]: DimValueGetter};
let prepareInvertedIndex: (list: List) => void;
let getRawValueFromStore: (list: List, dimIndex: number, rawIndex: number) => any;
let getIndicesCtor: (list: List) => DataArrayLikeConstructor;
let prepareChunks: (
    storage: DataStorage, dimInfo: DataDimensionInfo, chunkSize: number, chunkCount: number, end: number
) => void;
let getRawIndexWithoutIndices: (this: List, idx: number) => number;
let getRawIndexWithIndices: (this: List, idx: number) => number;
let getId: (list: List, rawIndex: number) => string;
let normalizeDimensions: (dimensions: ItrParamDims) => Array<DimensionLoose>;
let validateDimensions: (list: List, dims: DimensionName[]) => void;
let cloneListForMapAndSample: (original: List, excludeDimensions: DimensionName[]) => List;
let cloneDimStore: (originalDimStore: DataValueChunk[]) => DataValueChunk[];
let getInitialExtent: () => [number, number];
let setItemDataAndSeriesIndex: (this: Element, child: Element) => void;
let transferProperties: (target: List, source: List) => void;


export default List;