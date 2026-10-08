# 卡兹戴尔扩展图像来源

`bond.svg` 为本扩展自行编写的 SVG 几何图标，用旗帜与城垣表示卡兹戴尔盟约，沿用现有盟约的单色图标尺寸与展示方式；未复制官方阵营标志像素。原创绘制部分以 GPL-3.0-or-later 发布，官方名称及第三方内容的权利不因此改变。

干员立绘、头像、技能图标与战斗 Spine 模型由现有素材下载流程获取，保存在不提交源码的 `public/assets/`。十名成员的固定素材输入来自 `tools/kazdel-data-source.json`，下载计划位于 `tools/assets/kazdel-plan.mjs`。这些游戏素材适用根目录 NOTICE 的素材权属与使用声明。

魂灵与大炮的显示由 `public/js/render/fx/kazdel.js`、`public/js/render/units.js` 等代码生成。魂灵使用本体游戏模型叠加黑红半透明显示；大炮的格子预警、冲击、光束与充能条由程序绘制。
