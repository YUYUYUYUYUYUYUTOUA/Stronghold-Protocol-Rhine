# 卡兹戴尔扩展图像来源

`bond.png` 是用户于 2026-10-10 明确提供并指定用于替换卡兹戴尔盟约图标的原始 PNG。项目逐字节保存原图：812 × 876 像素、8-bit RGBA、透明背景，文件大小 66,476 字节；SHA256 为 `89f121f7b472917ac8da7b46c55011426a0343be4ac0824a288302a8e1a4d201`。未重绘、裁剪或改写像素，界面展示保留原图比例和透明度。

用户授权本项目使用这张图作为盟约图标；图像的原作者、权利人及再分发许可未随文件提供。提供文件及项目收录不构成对其权属或许可的确认，也不将其纳入项目代码的 GPL-3.0-or-later 授权范围。原先自行绘制的 `bond.svg` 已移除。

映射由 `tools/assets/kazdel-plan.mjs` 提供。只更新已打包的盟约图标时，运行 `node tools/fetch-kazdel-assets.mjs --manifest-only` 离线生成 `data/assets.json`，保留其他素材条目；完整下载和增量素材流程使用同一映射。

干员立绘、头像、技能图标与战斗 Spine 模型由现有素材下载流程获取，保存在不提交源码的 `public/assets/`。十名成员的固定素材输入来自 `tools/kazdel-data-source.json`，下载计划位于 `tools/assets/kazdel-plan.mjs`。这些游戏素材适用根目录 NOTICE 的素材权属与使用声明。

魂灵与大炮的显示由 `public/js/render/fx/kazdel.js`、`public/js/render/units.js` 等代码生成。魂灵使用本体游戏模型叠加黑红半透明显示；大炮的格子预警、冲击、光束与充能条由程序绘制。

## 已批准 v2 装备图（2026-10-10）

用户于 2026-10-10 审阅三张 v2 后确认“OK，没啥问题”，授权检查后更新 GitHub；本素材分支只供云端整合，机制改动与正式主线推送由云端任务处理。

`sigil-v2.png` 与 `blade-v2.png` 是内置 image_gen 使用五张实际正式装备 PNG 作为像素参考后重画的 256×256 透明 RGBA 插画。未经改写的生成原图逐字节保存在 `source/v2/sigil.png`（1299×1211）及 `source/v2/blade.png`（1309×1201）。游戏版仅裁近透明噪边、等比缩放和增加透明留白。

来源、完整提示、参考名称与 SHA256、透明度、尺寸和质量检查见 [v2 生成记录](../../../docs/kazdel-equipment-drill-art-v2.json)。`trap_kazdel_sigil`、`trap_kazdel_blade` 分别对应两件装备，普通与精锐共图。云端应在其较新映射中接入本版路径并再生清单，参见 [素材交接](../../../docs/art-integration-handoff-20261010.md)。

v1 画风已被用户否定，旧稿完整保留在本机原工作区及旧交付记录，本分支不收录或引用 v1 PNG。原卡兹戴尔徽记及正式参考图片未重绘。这些插画是生成的非官方扩展美术，沿用根目录 NOTICE 的素材与权利边界。
