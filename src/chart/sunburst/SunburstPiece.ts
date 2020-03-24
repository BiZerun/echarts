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

import * as zrUtil from 'zrender/src/core/util';
import * as graphic from '../../util/graphic';
import { ZRColor, ColorString } from '../../util/types';
import { TreeNode } from '../../data/Tree';
import SunburstSeriesModel, { SunburstSeriesNodeOption, SunburstSeriesOption } from './SunburstSeries';
import GlobalModel from '../../model/Global';
import { AllPropTypes } from 'zrender/src/core/types';

const NodeHighlightPolicy = {
    NONE: 'none', // not downplay others
    DESCENDANT: 'descendant',
    ANCESTOR: 'ancestor',
    SELF: 'self'
} as const;

const DEFAULT_SECTOR_Z = 2;
const DEFAULT_TEXT_Z = 4;

interface DrawTreeNode extends TreeNode {
    piece: SunburstPiece
}
/**
 * Sunburstce of Sunburst including Sector, Label, LabelLine
 */
class SunburstPiece extends graphic.Group {

    node: TreeNode;

    private _seriesModel: SunburstSeriesModel;
    private _ecModel: GlobalModel;

    constructor(node: TreeNode, seriesModel: SunburstSeriesModel, ecModel: GlobalModel) {
        super();

        let sector = new graphic.Sector({
            z2: DEFAULT_SECTOR_Z
        });
        graphic.getECData(sector).seriesIndex = seriesModel.seriesIndex;

        let text = new graphic.Text({
            z2: DEFAULT_TEXT_Z,
            silent: node.getModel<SunburstSeriesNodeOption>().get(['label', 'silent'])
        });
        this.add(sector);
        this.add(text);

        this.updateData(true, node, 'normal', seriesModel, ecModel);

        // Hover to change label and labelLine
        // FIXME
        // function onEmphasis() {
        //     text.ignore = text.hoverIgnore;
        // }
        // function onNormal() {
        //     text.ignore = text.normalIgnore;
        // }
        // this.on('emphasis', onEmphasis)
        //     .on('normal', onNormal)
        //     .on('mouseover', onEmphasis)
        //     .on('mouseout', onNormal);
    }

    updateData(
        firstCreate: boolean,
        node: TreeNode,
        state: 'emphasis' | 'normal' | 'highlight' | 'downplay',
        seriesModel?: SunburstSeriesModel,
        ecModel?: GlobalModel
    ) {
        this.node = node;
        (node as DrawTreeNode).piece = this;

        seriesModel = seriesModel || this._seriesModel;
        ecModel = ecModel || this._ecModel;

        let sector = this.childAt(0) as graphic.Sector;
        graphic.getECData(sector).dataIndex = node.dataIndex;

        let itemModel = node.getModel<SunburstSeriesNodeOption>();
        let layout = node.getLayout();
        // if (!layout) {
        //     console.log(node.getLayout());
        // }
        let sectorShape = zrUtil.extend({}, layout);
        sectorShape.label = null;

        let visualColor = getNodeColor(node, seriesModel, ecModel);

        fillDefaultColor(node, seriesModel, visualColor);

        let normalStyle = itemModel.getModel('itemStyle').getItemStyle();
        let style;
        if (state === 'normal') {
            style = normalStyle;
        }
        else {
            let stateStyle = itemModel.getModel([state, 'itemStyle'])
                .getItemStyle();
            style = zrUtil.merge(stateStyle, normalStyle);
        }
        style = zrUtil.defaults(
            {
                lineJoin: 'bevel',
                fill: style.fill || visualColor
            },
            style
        );

        if (firstCreate) {
            sector.setShape(sectorShape);
            sector.shape.r = layout.r0;
            graphic.updateProps(
                sector,
                {
                    shape: {
                        r: layout.r
                    }
                },
                seriesModel,
                node.dataIndex
            );
            sector.useStyle(style);
        }
        else if (typeof style.fill === 'object' && style.fill.type
            || typeof sector.style.fill === 'object' && sector.style.fill.type
        ) {
            // Disable animation for gradient since no interpolation method
            // is supported for gradient
            graphic.updateProps(sector, {
                shape: sectorShape
            }, seriesModel);
            sector.useStyle(style);
        }
        else {
            graphic.updateProps(sector, {
                shape: sectorShape,
                style: style
            }, seriesModel);
        }

        this._updateLabel(seriesModel, visualColor, state);

        let cursorStyle = itemModel.getShallow('cursor');
        cursorStyle && sector.attr('cursor', cursorStyle);

        if (firstCreate) {
            let highlightPolicy = seriesModel.getShallow('highlightPolicy');
            this._initEvents(sector, node, seriesModel, highlightPolicy);
        }

        this._seriesModel = seriesModel || this._seriesModel;
        this._ecModel = ecModel || this._ecModel;
    }

    onEmphasis(highlightPolicy: AllPropTypes<typeof NodeHighlightPolicy>) {
        let that = this;
        this.node.hostTree.root.eachNode(function (n: DrawTreeNode) {
            if (n.piece) {
                if (that.node === n) {
                    n.piece.updateData(false, n, 'emphasis');
                }
                else if (isNodeHighlighted(n, that.node, highlightPolicy)) {
                    n.piece.childAt(0).trigger('highlight');
                }
                else if (highlightPolicy !== NodeHighlightPolicy.NONE) {
                    n.piece.childAt(0).trigger('downplay');
                }
            }
        });
    }

    onNormal() {
        this.node.hostTree.root.eachNode(function (n: DrawTreeNode) {
            if (n.piece) {
                n.piece.updateData(false, n, 'normal');
            }
        });
    }

    onHighlight() {
        this.updateData(false, this.node, 'highlight');
    }

    onDownplay() {
        this.updateData(false, this.node, 'downplay');
    }

    _updateLabel(
        seriesModel: SunburstSeriesModel,
        visualColor: ColorString,
        state: 'emphasis' | 'normal' | 'highlight' | 'downplay'
    ) {
        let itemModel = this.node.getModel<SunburstSeriesNodeOption>();
        let normalModel = itemModel.getModel('label');
        let labelModel = state === 'normal' || state === 'emphasis'
            ? normalModel
            : itemModel.getModel([state, 'label']);
        let labelHoverModel = itemModel.getModel(['emphasis', 'label']);

        let text = zrUtil.retrieve(
            seriesModel.getFormattedLabel(
                this.node.dataIndex, state, null, null, 'label'
            ),
            this.node.name
        );
        if (getLabelAttr('show') === false) {
            text = '';
        }

        let layout = this.node.getLayout();
        let labelMinAngle = labelModel.get('minAngle');
        if (labelMinAngle == null) {
            labelMinAngle = normalModel.get('minAngle');
        }
        labelMinAngle = labelMinAngle / 180 * Math.PI;
        let angle = layout.endAngle - layout.startAngle;
        if (labelMinAngle != null && Math.abs(angle) < labelMinAngle) {
            // Not displaying text when angle is too small
            text = '';
        }

        let label = this.childAt(1) as graphic.Text;

        graphic.setLabelStyle(
            label, normalModel, labelHoverModel,
            {
                defaultText: labelModel.getShallow('show') ? text : null,
                autoColor: visualColor,
                useInsideStyle: true
            }
        );

        let midAngle = (layout.startAngle + layout.endAngle) / 2;
        let dx = Math.cos(midAngle);
        let dy = Math.sin(midAngle);

        let r;
        let labelPosition = getLabelAttr('position');
        let labelPadding = getLabelAttr('distance') || 0;
        let textAlign = getLabelAttr('align');
        if (labelPosition === 'outside') {
            r = layout.r + labelPadding;
            textAlign = midAngle > Math.PI / 2 ? 'right' : 'left';
        }
        else {
            if (!textAlign || textAlign === 'center') {
                r = (layout.r + layout.r0) / 2;
                textAlign = 'center';
            }
            else if (textAlign === 'left') {
                r = layout.r0 + labelPadding;
                if (midAngle > Math.PI / 2) {
                    textAlign = 'right';
                }
            }
            else if (textAlign === 'right') {
                r = layout.r - labelPadding;
                if (midAngle > Math.PI / 2) {
                    textAlign = 'left';
                }
            }
        }

        label.attr('style', {
            text: text,
            align: textAlign,
            verticalAlign: getLabelAttr('verticalAlign') || 'middle',
            opacity: getLabelAttr('opacity')
        });

        let textX = r * dx + layout.cx;
        let textY = r * dy + layout.cy;
        label.attr('position', [textX, textY]);

        let rotateType = getLabelAttr('rotate');
        let rotate = 0;
        if (rotateType === 'radial') {
            rotate = -midAngle;
            if (rotate < -Math.PI / 2) {
                rotate += Math.PI;
            }
        }
        else if (rotateType === 'tangential') {
            rotate = Math.PI / 2 - midAngle;
            if (rotate > Math.PI / 2) {
                rotate -= Math.PI;
            }
            else if (rotate < -Math.PI / 2) {
                rotate += Math.PI;
            }
        }
        else if (typeof rotateType === 'number') {
            rotate = rotateType * Math.PI / 180;
        }
        label.attr('rotation', rotate);

        type LabelOption = SunburstSeriesNodeOption['label'];
        function getLabelAttr<T extends keyof LabelOption>(name: T): LabelOption[T] {
            let stateAttr = labelModel.get(name);
            if (stateAttr == null) {
                return normalModel.get(name);
            }
            else {
                return stateAttr;
            }
        }
    }

    _initEvents(
        sector: graphic.Sector,
        node: TreeNode,
        seriesModel: SunburstSeriesModel,
        highlightPolicy: SunburstSeriesOption['highlightPolicy']
    ) {
        sector.off('mouseover').off('mouseout').off('emphasis').off('normal');

        let that = this;
        let onEmphasis = function () {
            that.onEmphasis(highlightPolicy);
        };
        let onNormal = function () {
            that.onNormal();
        };
        let onDownplay = function () {
            that.onDownplay();
        };
        let onHighlight = function () {
            that.onHighlight();
        };

        if (seriesModel.isAnimationEnabled()) {
            sector
                .on('mouseover', onEmphasis)
                .on('mouseout', onNormal)
                .on('emphasis', onEmphasis)
                .on('normal', onNormal)
                .on('downplay', onDownplay)
                .on('highlight', onHighlight);
        }
    }

}


export default SunburstPiece;


/**
 * Get node color
 */
function getNodeColor(
    node: TreeNode,
    seriesModel: SunburstSeriesModel,
    ecModel: GlobalModel
) {
    // Color from visualMap
    let visualColor = node.getVisual('color');
    let visualMetaList = node.getVisual('visualMeta');
    if (!visualMetaList || visualMetaList.length === 0) {
        // Use first-generation color if has no visualMap
        visualColor = null;
    }

    // Self color or level color
    let color = node.getModel<SunburstSeriesNodeOption>().get(['itemStyle', 'color']);
    if (color) {
        return color;
    }
    else if (visualColor) {
        // Color mapping
        return visualColor;
    }
    else if (node.depth === 0) {
        // Virtual root node
        return ecModel.option.color[0];
    }
    else {
        // First-generation color
        let length = ecModel.option.color.length;
        color = ecModel.option.color[getRootId(node) % length];
    }
    return color;
}

/**
 * Get index of root in sorted order
 *
 * @param {TreeNode} node current node
 * @return {number} index in root
 */
function getRootId(node: TreeNode) {
    let ancestor = node;
    while (ancestor.depth > 1) {
        ancestor = ancestor.parentNode;
    }

    let virtualRoot = node.getAncestors()[0];
    return zrUtil.indexOf(virtualRoot.children, ancestor);
}

function isNodeHighlighted(
    node: TreeNode,
    activeNode: TreeNode,
    policy: AllPropTypes<typeof NodeHighlightPolicy>
) {
    if (policy === NodeHighlightPolicy.NONE) {
        return false;
    }
    else if (policy === NodeHighlightPolicy.SELF) {
        return node === activeNode;
    }
    else if (policy === NodeHighlightPolicy.ANCESTOR) {
        return node === activeNode || node.isAncestorOf(activeNode);
    }
    else {
        return node === activeNode || node.isDescendantOf(activeNode);
    }
}

// Fix tooltip callback function params.color incorrect when pick a default color
function fillDefaultColor(node: TreeNode, seriesModel: SunburstSeriesModel, color: ZRColor) {
    let data = seriesModel.getData();
    data.setItemVisual(node.dataIndex, 'color', color);
}