# 卡兹戴尔徽记与批准 v2 素材交接

本素材分支为 `codex/kazdel-icons-v2-handoff-20261010`，基于已核验远端正式分支 `codex/rhine-upstream-021` 的 `5dc9d715b2c4752ee0515fe72091d4454f9b6568`。用户于 2026-10-10 确认三张 v2 无问题，并授权检查后更新 GitHub。此分支只作为 HOME_PC 到云端工程的整合入口；正式主线、魂灵可释放技能的机制和最终推送由云端工程任务处理。不包含 Release、标签或部署。

## 本分支包含的改动

- 原用户卡兹戴尔徽记 `public/art/kazdel/bond.png`，原字节、812×876 比例及透明度保持不变；SHA256：`89f121f7b472917ac8da7b46c55011426a0343be4ac0824a288302a8e1a4d201`。原桌面文件不修改。
- 盟约加载映射、HUD 与预览入口换用 PNG；CSS 只改变显示明暗和 `object-fit`。
- 卡兹戴尔层数浮标使用 RGB 反色矩阵并保留 alpha、等比尺寸和异步加载生命周期；滤镜随 FX 销毁。不要用 Pixi `negative()` 替代该矩阵，后者会使透明边和淡出重复受 alpha 影响。
- 三张批准 v2 的源 PNG、256px 装备/装置图标和 512px 钻机场上贴图；完整来源、提示、SHA256 和检查记录见 [v2 记录](kazdel-equipment-drill-art-v2.json)。v1 旧稿保留在本机原工作区及旧交付中，本分支不收录 v1 PNG。
- 对应徽记单元测试、真实浏览器测试与发布检查工具；不修改服务器、模拟、平衡、黄金样例或云端机制。

## 云端必须按其当前代码合并

云端未推送的 `57d1aebd`、`a99e1c6e`、`5dd4aa91` 等机制提交应保持。以下是潜在交叉文件，不要整文件覆盖其较新内容：

- `tools/assets/kazdel-plan.mjs`：保留本分支 `bonds.kazdelShip` 的 PNG 路径，并保留云端两件新装备的映射。
- `data/assets.json`：本分支相对基线只变化 `/bonds/kazdelShip` 与 `/hash`。云端在合并自己的新映射后重新生成该文件，保留其全部新素材条目。
- `public/js/render/app.js`：只合入 `KAZDEL_BOND` 导入及 `fx.pop` 的第五个反色参数，保留云端其他事件/渲染逻辑。
- `public/js/ui/kazdelHud.js`：合入图片路径替换，保留云端 HUD 改动。
- `tools/verify-rhine-release.mjs` 及测试：合入徽记 PNG 路径、格式/字节检查，保留云端机制验证。

此旧基线没有云端新装备，因此本分支不抢先添加其消费映射。云端应按实际新代码接入：

| 消费键 | 批准 v2 路径 |
| --- | --- |
| `trap_kazdel_sigil`，`chess_item_kazdel_sigil_a/_b` 共图 | `/art/kazdel/sigil-v2.png` |
| `trap_kazdel_blade`，`chess_item_kazdel_blade_a/_b` 共图 | `/art/kazdel/blade-v2.png` |
| 原 `token_rhine_laser` 的 `RHINE_DEVICES` icon | `/art/rhine/laser-v2.png` |
| 同一钻机的 sprite | `/art/rhine/laser-unit-v2.png` |

钻机仍为原立地研究装置，不新增第三件装备。完成云端图标映射及共享装置字段后，按其正式资源流程再生数据并复测发布校验。

当前基线的 `verifyRhineDeviceRelease` 仍要求 `laser.svg` 和 5 个资源入口。云端整合 PNG 时应同时校验 icon 与 sprite 两条不同 URL，相应改为 6 个入口（其余4个代码资源不变），并保留原有九莱茵解锁、固定阶段与机制校验。

## 钻机发射口显示坐标

原始 1254×1254 PNG 的右侧紫色口中心约 `(1067,430)`；按主体 alpha>8 框归一化为 `(0.90807,0.33851)`。这个值不是 `RHINE_LOOK.core`。

实际 Chrome 154.0.8037.98 的 Canvas 按当前 `unitSpriteTexture` 路径把 512px 场上 PNG 缩到 384px 后，alpha>8 框为 `[45,23,339,361]`（右下排他），加代码的 1px 边界后 texture frame 为 `{x:44,y:22,width:296,height:340}`。右紫色口像素中心质心为 `(311.875291,137.152681)`。在 sprite anchor `(0.5,1)` 下：

```text
coreX = (311.875291 - 44) / 296 - 0.5 = 0.4049840925
coreY = 1 - (137.152681 - 22) / 340 = 0.6613156451
RHINE_LOOK.laser.core 建议：[0.405, 0.6613]
```

这组坐标适用于上述现行纹理缩放/裁框/anchor 流程。云端若已改变流程，应按其实际新流程重算。当前发光 core 随 `sprite.position.y = -0.006 tile` 的 pose 移动，但 beam 起点尚未包含这项位移；云端可让 beam 起点跟随实际 sprite position，消除 0.006 tile 显示偏差。仅调整显示，不能改射程、目标、伤害或持续输出规则。本分支仍引用旧 SVG，故这里不预改运行时 core。

## 已运行验证

- 相关单元、发布检查与文档测试：52/52 通过。
- 实际 HTTP/UI/Pixi 徽记浏览器验收：3/3 通过；覆盖 12–32px、深浅背景、active/inactive/off、原图 SHA256/比例、46px 浮标及 GPU alpha 提取。
- 实际修改 JavaScript 文件 lint 与 `git diff --check` 通过。
- v2 与五张真实正式装备 PNG 对照，24/32/48/64px 深浅背景、完整部件、透明边检查通过；24px 战刃较细但类别可辨。
- 原基线和本分支的导入扫描均显示同样三项 `server/sim/nodeData.js` 的 `[sim-node]` 既有提示，未改该文件，也不把这项称为严格扫描全绿。未运行全量 CI 或真实全素材战斗套件。

只提交本文所列素材、显示/加载修复及测试；不提交官方参考 PNG、下载缓存、依赖、浏览器截图或否定 v1。
