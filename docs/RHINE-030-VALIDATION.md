# v0.3.0 阵营拓展源码验收

本轮从正式主线 `45d962f7` 合并上游发布标签 `v0.3.0` 的固定提交 `c24e17eec3af1e6dedfa9935a6d15245cf2f4586`，不包含标签之后的 master。合并提交为 `7f2e98ba`；后续完成已授权机制、.3 兼容与启动路径修正，并补齐回归夹具和发行验证，不改批准数值。具体实际结果与未完成边界逐轮记录如下。

## 源码检查

Linux Node 24.19.0 执行 `npm run ci -- --keep-going`：8,513 项、8,400 通过、25 失败、88 条件跳过。启动、lint、导入、类型检查全部通过；原有 0.5 ms/tick 性能门槛也通过。该轮从适配过程中启动，不能将其称作全绿。

23 项功能／夹具失败已修复，涉及旧卡池种子、合作私库翻倍、随机首领配对、大小写文件名冲突先于语言归一化、Node 的 TAP/spec 报告差异、重连假时钟竞速，以及循环界声明。保持真实库存、死亡／复活、双倍生命池、结果接受和拒绝断言。最终统一复测受影响的 19 个文件：**220 项通过，0 失败，0 跳过**。

另外两项 `test/studio/review.test.js` 的 Unix 孙进程清理断言仍失败，未放宽或跳过。隔离复跑捕获 close 的 PID 30607、timeout 的 PID 30657：初始为运行状态，清理后均为 **Z／PPID 1**，startTicks 未改变，各进程组运行成员为 0、组长已消失。此容器 PID 1 未回收僵尸，`kill(pid, 0)` 仍成功，导致严格 ESRCH 断言失败。必须与真正仍在运行的泄漏区分；本报告不把这两项改记为通过。远端 CI 和 Windows 原生门槛独立记录。

## 机制与数据证据

- 180 个完整单人／合作种子对局均到达结算且零比赛错误；另验确定性和服务端后备模式。
- 五／六名真实客户端模拟均走完 R1–R14，比赛错误、结果拒绝与意外接管均为 0；六人 200% 共享生命池及接管不重复放大通过。
- 全部 **288 个 golden** 重算并复核一致，变动逐项及唯一保留的余音反击例外见 [ledger](RHINE-030-GOLDEN.md)。
- 严格 i18n 四包各 1,858／1,858，零遗漏／错误。固定原版 22 文件与发布标签逐字节一致，依次叠加三个扩展可精确重建八个受影响表。当前环境缺少官方原始表缓存，未声称已重新从全部原始表推导。
- 最终卡池精确枚举、逐阶八种约束及 .3 私库概率语义见 [审计](RHINE-030-POOL-AUDIT.md)。6+6 的 213,444 组合中 212,999 合格，445 个不足八种的组合被排除。
- Linux Chromium 的原版切换、插件验证、Worker、cs 结果提交及篡改接管核心断言通过；无完整美术、字体与音频，整套浏览器资源检查出现 404／音频／Spine 错误，**未记作整套通过**。

## Windows 与发布边界

未公开的 `.1` 候选在原生 Windows 暴露一处上游测试夹具路径问题：`contentBattle.test.js` 复制浏览器模拟器时以 `/nodeData.js` 后缀过滤，在 Windows 的反斜杠路径下失效，误复制 Node 加载器并产生顶层 `await` 循环。首个包内回归在 300 秒整批期限中止，没有最终测试汇总；不能记作通过或仅归因慢机器。后续按文件名过滤并明确断言 Node 加载器不存在，保留真实浏览器模拟器与服务器结果一致性断言。`.1` 标签保持原指向，修复后的候选使用 `.2`，实际包仍需独立完成下列发行门槛。

未公开的 `.2` 候选在真实 Windows x64／Node 24.21.0 完成 847 项包内回归：843 通过、2 失败、2 条件跳过、0 取消，129.6 秒，无加载器死锁。失败是插件作者 CLI 把原生 Windows 路径交给 ESM `--import`，以及 watchdog 断言误用 `child.killed`（Windows 先经 `taskkill` 实际结束进程，该属性并不表示实际存活状态）。`.3` 修复 CLI 为文件 URL，并保留真实作者测试，使用带空格和 `#` 的安装路径验证；watchdog 改验已观察到退出、PID 不存在及零活动任务。还修正精锐 DIY 的测试槽位归一化、Docker CRLF 行解析、Forge 可执行诱饵被测试发现器误执行，以及沙箱测试人为压短冷启动预算造成的竞速；生产沙箱期限未放宽。`.1`、`.2` 标签及草稿保留，均不公开为玩家安装包。

Windows Node 22 的 `rhine-online-update.test.js` 曾以原生退出码 `3221226505` 结束，未产生 JavaScript 堆栈。旧正式版 `v0.2.4-rhine.6` 的 CI 同文件、同退出码且为该 Windows Node 22 任务唯一失败；同轮 Windows Node 24 与两组 Ubuntu 均通过。这是当时已有的可复现基线限制，不能归为适配新增回归；随后 `v0.3.0-rhine.6` 仅调整测试夹具的复制遍历路径，两轮 Windows Node 22 的全部 28 项更新测试均实际通过，详见下方终态。未宣称修复 Node 底层缺陷；发行仍必须使用真正 Windows x64 的包内 Node 24.21.0 验证更新路径。

上述兼容修改最终统一复测八个受影响文件：**82 通过、0 失败、0 取消／跳过**。旧候选 Ubuntu Node 22 另有一次 WebSocket 2 秒等待和脚本宿主 10 秒心跳失败；两个完整宿主测试文件低并发独立复核 **9 通过、0 失败／跳过**，保留原等待、心跳与沙箱期限，没有仅据隔离通过把旧 CI 改记全绿。这两个完整宿主文件及作者发行流程也列入新候选原生 Windows 门槛，结果独立记录。

### `.3` 的实际结果与 `.4` 修正

不可变源码 `5fc855ae01435a7bd8cef307baad176a7f0ae875` 的 [CI 38860274239](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38860274239) 已完成，不能记作矩阵全绿：

| 环境 | 项目／通过／失败／跳过 | 真实失败 |
| --- | --- | --- |
| Ubuntu Node 24 | 8519／8424／0／95 | 无；服务启动检查也通过 |
| Ubuntu Node 22 | 8519／8422／2／95 | 两项插件宿主测试在配置房间时超过 WebSocket 2 秒请求期限 |
| Windows Node 24 | 8519／8433／1／85 | Studio 的 `probe-timeout` 测试在其人为注入的 1 秒预算内未进入真正作者代码，因而没有 PID 标记 |
| Windows Node 22 | 8497／8408／4／85 | 一项房间配置请求超时、沙箱完整对局 10 秒无心跳、同一 Studio 探针夹具问题，以及前述更新测试原生崩溃 |

tooling 成功，所有任务取消数为 0。请求和心跳失败的完整并行运行原因尚未查明，隔离通过不抹去这些失败。Studio 探针测试改为采用生产公开的 5000 毫秒预算，仍必须先观察真实作者代码写出的 PID，再验证实际超时、进程退出和 ESRCH；没有改变生产预算或把缺少标记当作成功。

同一 `.3` 源码的 [Windows 发行验收 38862614651](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38862614651) 中，包内 Node 24.21.0 的 **915 项／913 通过／0 失败／2 条件跳过**、源码作者发行 4／4、插件宿主 9／9、浏览器模拟 2／2，以及真实素材援军移动的 55／55 帧均通过。七项批准机制均有实际 Windows 通过用例。随后立绘测试失败，因此该候选始终未公开，其余浏览器、实际 `.6` 升级和附件下载门槛尚未执行。

这次立绘失败有明确根因：旧测试手工加载 Pixi 并直接创建 Application，绕过上游 `.3` 的 `ensurePixi()` 和 `installPixiNoEval()`，触发严格 CSP 的 `unsafe-eval` 拒绝。`.4` 仅把该测试改为使用实际生产加载入口，保留 CSP、19 个模型、原图 SHA 和像素断言；游戏页面原本已走该入口。此前一次 30 秒导航超时未在后续原生诊断中重现，原因仍未查明，诊断通过未作为视觉验收通过。`.3` 标签保持不动，后续候选必须重新跑完整发行门槛。

`.4` 修正的本地定向证据：同一真实 Chromium／站点 CSP 下，旧 Pixi 入口在实际绘制时拒绝 `unsafe-eval`，生产 `ensurePixi()` 在依然禁止 `Function` 的条件下成功 WebGL 绘制并提取 1024 个可见像素；CSP 回归 5／5。完整模型资源本地缺失，未声称 19 模型已经通过。Studio `probe-timeout` 采用真实 5000 毫秒预算后，实际 PID 标记、SIGKILL 期限及两个 PID 的 ESRCH 全部通过，单项 7.088 秒；未改外层期限。新增原生 Windows 发行门槛将完整 Studio review 文件与作者发行一起串行验证。

两项范围边界保持上游语义：引导训练为 0 BAN，险境及以上的 1–4 人局为 6+6，标准模拟为 3+3；暴行仍依原版 `IN_BATTLE` 产层规则在普通主战结算层数，联防／首领不额外产层。雷姆援军出现数的攻血增益则单独携带至同轮联防。

### `.4` 原生验收与浏览器夹具收尾

源码 `4ea4d5b0182c3c1fedf53b22cd63e9cf2a8b3416` 的 [Windows Node 24 全套 CI](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38864282683/job/116853427630) 成功：8519 项、8434 通过、0 失败、0 取消、85 条件跳过，1231.859 秒；安装、setup check 和服务启动检查均成功。Studio close／timeout／probe-timeout 的实际 PID 和退出断言全部通过。其余环境结果须另看该源码对应 CI，不能据一个成功任务称矩阵全绿。

`.4` 首轮安装包验收的新增 Studio review 批次继承了发行默认的 `SP_STUDIO=off`，一个 HTTP 试验请求测试因此等待永不发生的启动而在 300 秒整批期限中止。对同一真实测试的本地正反例确认：off 在 12 秒仍不返回，lan 在 315 毫秒通过。随后仅修正该隔离测试批次的环境为 lan，复用相同源码和草稿，保留原期限与全部断言。

[恢复后的实际 Windows 验收 38865524781](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38865524781) 已通过：包内 915 项／913 通过／0 失败／2 条件跳过；完整作者发行及 Studio review 27／27；插件宿主 9／9；雷姆／莱茵浏览器模拟 2／2；雷姆真实 19 模型、原图 SHA、移动渲染 2／2；集合点交互 1／1。卡兹戴尔浏览器模拟的五项随后全部在旧夹具 `eval` 上被 `.3` 严格 CSP 拒绝，尚未比较玩法结果。余下渲染／UI、真实 `.6` 升级、压缩与附件校验均未执行，该候选未公开。

`.5` 将这五项夹具改为实际浏览器模拟器的远程句柄与函数调用，与已通过的雷姆测试方式一致；不改 CSP 或玩法逻辑，不减少场地、炮击归属、装备、原生魂灵、联防及反应伤害的一致性断言。旧标签保持原指向，新候选重新执行全部发行门槛。两项包内条件跳过仅为可选空目录素材下载与便携包缺少固定上游 Git 对象；发行流程另行执行真实资源下载、固定快照和清单哈希校验，七项机制没有跳过。

修正后的五项模拟在真正 Linux Chromium 中 **5／5 通过、0 跳过／取消**，20.72 秒；28 条断言和五个模拟函数体经 AST 逐字比较全部不变。剩余发行浏览器入口及其 310 文件导入闭包、七个渲染测试及演示依赖均检查了动态代码生成、Pixi 初始化、内联脚本、模块路径和 API 使用。另发现卡兹戴尔预览页 import map 的单行排版与已有 CSP 哈希不同：仅将该 HTML 的 import map 字节与官方 render-demo 保持一致，JSON 映射语义不变，服务器 CSP 及其哈希集合完全不变；扩充现有 CSP 检查覆盖此页，并把完整五项 CSP 检查纳入包内回归。没有将静态审查等同于尚未执行的原生 Windows 全浏览器验收。

### `.5` 终态与剩余浏览器预检

源码 `ca282a1ef45878923e2511ac9ae928498fc948d4` 的 [完整 CI 38867452789](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38867452789) 已结束：Ubuntu Node 22／24 均为 8519 项、8424 通过、0 失败、95 条件跳过；Windows Node 24 为 8519 项、8434 通过、0 失败、85 条件跳过，安装、setup、服务启动检查均通过，tooling 也通过。Windows Node 22 为 8497 项、8411 通过、1 失败、85 条件跳过；唯一失败仍是更新测试进程原生退出 `3221226505`，没有额外堆栈。因此矩阵不是全绿。

[`.5` 的原生 Windows 发行验收 38867454299](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38867454299) 中，包内 **920 项／918 通过／0 失败／2 条件跳过**，完整作者与 Studio review **27／27**，隔离插件宿主 **9／9**；雷姆／莱茵浏览器模拟 **2／2**、雷姆真实立绘与移动 **2／2**、集合点 **1／1**、卡兹戴尔／反应模拟 **5／5**、阵营渲染 **13／13**、莱茵干员渲染 **2／2**、上游姿态与恢复渲染 **7／7** 全部通过。随后上游 UI 组 **8 项／7 通过／1 失败**：旧原版切换夹具仍引用已经移除的 `chess_rhine_dorothy_a`，在读取其阶数时失败；白面鸮与塞雷娅的前置断言已经通过。后续六人、统计、插件 UI、真实旧包升级及附件门槛均未执行，草稿未公开。

当时为下一候选安排固定旧 `.6` 与上游 `.3` 的完整真实素材预检，集中排除旧干员 ID、设置页滚动和隔离比赛测试配置问题；后续 `.6` 原生结果另列于下方。完整素材由两份已固定 SHA256 的发行 ZIP 提取，逐成员校验 CRC 与内容哈希；上游素材中不在官方稀疏清单的部分由整体 ZIP 的固定哈希覆盖，不称为逐文件官方清单覆盖。普通源码环境的本地 HTTP／WebSocket 验证已通过，含 214 个 HTTP 资源、真实 welcome 与 pong；这不能替代实际 Windows 包的同项验收。

浏览器夹具已查明的适配差异：原版切换使用现存的莱茵专属麦哲伦记录替换移除的多萝西，并读取真实模拟 Worker 内安装的原版表；待观察的场次按本玩家、普通战斗、R1、权威 `b.start.battleId` 精确锁定，避免误取同轮非权威联防。隔离子进程通过生产已有的测试模块接口加载同一个 FastMatch，使原有 R14、起始队伍与加速配置真正作用于原版／插件场景；导入夹具不会额外启动 HTTP。六人画质操作使用真实滚动、点击与 aria／持久设置回读。内容插件保留实际战斗对象引用至结算后，仍验证真实权威、送达与内容哈希，避免 PREP 清理条目后的空读。

沙箱两浏览器的原始 16 倍速诊断仍失败，不能记作通过：两端内容哈希一致、真实 Worker 和 sandbox 策略均正确，页面与模拟异常为 0，但冷准备约 10–13 秒，实际每 tick 约 8.85／9.38 毫秒，无法满足 16 倍速每 tick 约 2.08 毫秒的吞吐；前四轮均由服务端以 timeout 接管，`checked=0`。该夹具改用生产默认 2 倍速，保留 90 秒测试观察、300 秒单项上限和生产 15 秒接管宽限，仍要求真实客户端结果被重放验证、零 mismatch／rejected，并保留严格 CSP、SES 与双浏览器；不以接管或仅收到 OK 代替通过。修正前后实际结果分开记录。修正后的完整素材 Linux Chromium 沙箱用例实际 **1／1 通过**，75.399 秒：固定 R1 的两名玩家场次均为 `resultSource=client`、`checked=2`、mismatch／rejected／takeovers 全为 0，页面／控制台／资源错误为 0；额外限时页面诊断有两次 5 秒未返回，不计作功能断言通过或失败，其超时原样记录。

原版切换的生产 2 倍速、高画质 1920×1080 三浏览器复验仍失败：三端真实普通场权威与安装表均通过，原版房主完成并提交结果，但队友没有在期限内提交，之后出现真实接管；完整结果重放、重连和最终零错误门槛未执行，不称整套通过。实际环境为 cgroup 四核配额，三张软件渲染画面下 Worker 冷准备约 21–24 秒。夹具随后通过真实设置界面为三端选择低画质并回读，保留视口、引擎 Canvas 与全部模拟断言和期限；该设置关闭原有阴影／抗锯齿，仅影响渲染，不替换模拟器。

内容插件固定首场观察也修复为先采集、再与 HUD 截图并行；修正前确实漏掉结算已经清理的 R1。此后一次真实 16 倍速复验已捕获 R1，却发现房主的 `resultSource=server`，不能算作结果接受；该次未捕获具体接管 reason，不直接归因 timeout。后续使用生产默认 2 倍速并补齐原因诊断，仍要求正常房主真实客户端结果，以及篡改队友的无权威、无结果提交和服务端接管。

内容插件的后续完整素材、生产 2 倍速复验实际 **1／1 通过**，88.909 秒：固定 R1 房主场次为真实客户端权威与 `resultSource=client`，伪造内容哈希的队友无结果上传并由服务端 timeout 接管，页面／控制台／资源错误为 0。沙箱及内容插件的通过记录对应各自当前文件；此前失败批次保留为失败，不把定向通过改记为整批全绿。两项完整 Studio 浏览器流程、六人布局及选定的手机横屏统计用例也已在本地完整素材环境通过。

三客户端切换采用真实低画质及自有软件 GPU 进程优先级后，192.893 秒的完整复验仍为 **1 项／0 通过／1 失败**。三端普通场权威、真实 Worker 表、三份实际结果上传及各自 Node 独立重放哈希、零模拟错误、R2 结算均通过；随后原有的 15 秒网络空闲等待超时，重连及最终页面／服务端零错误断言尚未执行。没有延长生产 Worker 加载／步进或接管期限，也没有把服务端后备结果算作客户端通过。

带请求 URL 诊断的后续 212.136 秒复验仍失败于该等待，实际 R2 未完成请求为官方特效 mesh／texture 的持续后台预取。生产特效的有限递归预取不会在进入 PREP 时取消，画质设为低也不会关闭独立的官方特效设置。该机制夹具随后在首次战斗前通过真实设置界面选择官方特效“关”，严格回读 aria 与持久设置；保留引擎 Canvas、三独立浏览器、全部战斗及资源断言、原网络等待。此用例因此不覆盖官方特效视觉表现，其他渲染组的原设置不变。

修正后的三客户端完整复验实际 **1／1 通过、0 失败／跳过**，203.198 秒。三端真实普通场权威、Worker 内原版／扩展数据表、三份实际结果上传与 Node 独立重放哈希、R2 结算和零模拟错误全部通过；原 15 秒网络空闲等待、真实对局中 reload、原版内容保持、引擎 Canvas、最终页面／控制台／资源及服务端零错误门槛也均执行通过。三独立浏览器仍为 1920×1080；此成功不抹去前述失败记录。

六人组适配真实引擎／简化棋盘的公开坐标接口后，最后一轮完整素材 Linux 复验 **2 项／0 通过／2 失败／0 跳过**，499.236 秒。两种配置的房主均为真实引擎、1280×720 Canvas，坐标检查通过，页面／资源错误为 0；莱茵无场地警告，原版六端出现非致命的 `highlightTiles` 在空对象上读取 `clear` 的场地警告，原因尚未查明，不将警告称作零。莱茵组真实装备与奖励操作成功，但后续操作耗尽 PREP，六人准备确认未完成。原版初始权威玩家仍在 loading 时，12.081 秒即发生生产 silence 接管；六端首次非 loading 约 31.6–35.7 秒，包含启动、追帧和调度，不能称为纯 Worker 构造耗时。之后替补与另两场虽实际上传零错误结果，仍缺少初始权威场次上传，不能替代该硬断言；现有警告不能证明接管原因。保留原 16 倍首领夹具、准备／结算期限、六名真实玩家、三份初始权威上传和精确共享池重放要求；该轮失败不改记为通过，后续由原生 Windows 重新执行相同严格门槛。

Windows Node 22 崩溃进一步定位到首个异步准备测试：前五个同步元数据测试已通过，第六个准备测试首次进入响应体下载和中文目录递归复制流程，随后整文件进程退出；现有日志不能进一步证明具体原生崩溃点。Node 官方 [#59636](https://github.com/nodejs/node/issues/59636) 记录了 Windows 中文目录 `fs.cpSync` 的相同原生退出码；精确版本 `v22.23.3` 的无 filter 分支进入 C++ 目录复制，传入 filter 才逐项使用 JavaScript 遍历。`.6` 仅为夹具复制增加恒真的 filter，保留中文路径、全部文件与原断言；这是避开已知运行时路径的夹具调整，不宣称修复 Node 底层缺陷。本地完整文件 28 项、25 通过、0 失败、3 条原 Windows 专用跳过；当时 Windows 结果待验，随后两轮真实 Windows Node 22 均为 28／28 实跑通过，且没有重现原生退出，源 CI 整体仍因其他失败而未通过。

### `.6` 两轮源码 CI 的实际终态

不可变标签源码 `c7799362a1366a430ff8e9393828468f10ca7326` 的 [CI 38881679392](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38881679392)，以及仅发行请求 JSON 不同的正式元数据提交 `8d2ff728dfe420bf338b04009c7f5b4b08aafb5d` 的 [CI 38881679682](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38881679682)，均已封存为 **failure**，没有重跑覆盖。两轮 tooling 的 lint／导入／类型检查均成功；Node 22 实际为 22.23.3，Node 24 为 24.21.0。

| CI | 环境 | 项目／通过／失败／跳过 | 实际失败类别 |
| --- | --- | --- | --- |
| 标签源码 | Ubuntu Node 22 | 8519／8424／0／95 | 无 |
| 标签源码 | Ubuntu Node 24 | 8519／8422／2／95 | watchdog、OOM 用例的房间配置请求各超时一次 |
| 标签源码 | Windows Node 22 | 8519／8431／3／85 | OOM、验证用例的房间配置请求超时；SES 完整对局 11 秒无心跳 |
| 标签源码 | Windows Node 24 | 8519／8434／0／85 | 无 |
| 正式元数据 | Ubuntu Node 22 | 8519／8421／3／95 | watchdog、OOM 用例的房间配置请求超时；SES 完整对局 10 秒无心跳 |
| 正式元数据 | Ubuntu Node 24 | 8519／8424／0／95 | 无 |
| 正式元数据 | Windows Node 22 | 8519／8430／4／85 | watchdog、OOM、验证用例的房间配置请求超时；SES 完整对局 10 秒无心跳 |
| 正式元数据 | Windows Node 24 | 8519／8434／0／85 | 无 |

八个测试任务的取消数均为 0，完整汇总没有因更新测试进程崩溃而丢失后续用例。四个 Windows 任务的更新测试全部 **28／28 实跑通过、0 跳过**，包含首个异步准备、真实 Windows ZIP 提取和 BAT 启动；四个 Ubuntu 任务为 25 通过、3 条原有 Windows 专用跳过。这验证了夹具 workaround 在本轮真实 Windows Node 22 下避开原退出路径，不能扩大为 Node 原生缺陷已修复或整个源码矩阵已通过。

配置超时的日志直接堆栈只有 `test/helpers/wsClient.js:106`，默认请求预算 2000 毫秒。依据固定源码及已收到的帧序列，调用位置可重建为 `test/match/plugin-host.test.js:198` 的 `room.setPlugins`；验证用例对应 `:276`。前两类失败尚未到 `room.start`，也尚未执行真正 watchdog／OOM 作者攻击。这个调用位置是日志与源码联合推导，不是日志打印出的异步调用栈；CPU 争用尚未被证明为唯一原因。另一类 `test/plugins/sandbox-host.test.js:61` 则确实在真实 SES 全机器人对局中收到 `plugin-hang`、10／11 秒无心跳，并因缺少 boolean victory 失败，不能混同为房间准备问题。

四个单元任务成功的环境随后服务启动 smoke 成功，四个失败环境的该步被跳过。现有 smoke 脚本以 `kill $pid || true` 结束，未等待并断言服务 PID 的退出码，doctor 也带 `|| true`；服务启动检查通过不能独立证明干净的 SIGTERM 退出。

### `.6` 原生 Windows 安装包验收终态

同一源码与正式元数据的 [Windows 发行验收 38881679610](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38881679610/job/116909652181) 使用真实 Windows x64／包内 Node 24.21.0，最终为 **failure**。包内回归 **920 项／918 通过／0 失败／2 条件跳过**，完整源码作者与 Studio review **27／27**、隔离插件宿主 **9／9**，全部取消数为 0；七项批准机制均有实际通过用例。两条包内跳过仍是可选空资源目录 live 下载、便携包不含固定上游 Git 对象，资源下载及固定快照校验已由准备步骤另行实际执行。

自动化继续执行全部 11 个独立浏览器组，保留各组结果后统一拒绝失败候选，合计 **48 项／43 通过／5 失败／0 跳过／0 取消**：

| 浏览器组 | 项目／通过／失败 | 失败或覆盖边界 |
| --- | --- | --- |
| 雷姆／莱茵模拟 | 2／2／0 | 无 |
| 雷姆立绘／移动 | 2／2／0 | 真实 19 模型、原图及移动渲染 |
| 雷姆集合点 | 1／1／0 | 无 |
| 卡兹戴尔／反应模拟 | 5／5／0 | 无 |
| 阵营渲染 | 13／12／1 | 卡兹戴尔图标读取空 `currentSrc`，构造 URL 失败 |
| 莱茵干员渲染 | 2／2／0 | 无 |
| 上游姿态／恢复 | 7／7／0 | 无 |
| 上游 UI | 8／7／1 | 原版切换 `waitProfile` 在 30 秒内未观察目标配置 |
| 六人 UI／机制 | 3／2／1 | 布局和莱茵用例通过，原版六人失败；莱茵有简化棋盘边界 |
| 手机横屏统计 | 1／1／0 | 无 |
| 插件／Studio UI | 4／2／2 | 两项 Studio 通过，内容插件与沙箱插件未在 120 秒内观察首场 COMBAT |

上游 UI 失败点为 `rhine-profiles.e2e.test.js:113`／调用 `:312`，当时三端诊断均仍为 rhine、`serverCombat` 为空；不能称原版切换完成。两项插件失败时实际仍为 R1 PREP、`ready=false`、`inMatch=false`，未满足首场战斗门槛；不能据此声称客户端结果已被接受或已经通过重放验证，也没有证据把具体原因定为某项生产超时。

六人莱茵用例虽通过，其信标操作时 `fieldAtBeacon=fallback`，且记录 `createFieldView timed out` 后采用简化棋盘；不能称该场持续运行健康的完整引擎 Canvas 或没有场地警告。原版六端 `stats.errors` 均为 1，四端首场 `localPools` 为空、tick 为 0；这些端随后 `forced`、`time=0`、缺少 cs 的上报不是成功模拟。该轮失败于 `six-player-balance.e2e.test.js:466`／`:473` 的原池值及 runner 零错误等待。原日志没有捕获这些端准备过程的 RPC 方法／错误码，15 秒加载超时仍只是时序支持的推测，不记为已证实根因；不能用后续替补结果补齐初始权威断言。

所有浏览器组结束后自动化非零退出，草稿 `414778774` **未公开**。包内 HTTP／WebSocket smoke、ZIP 压缩／重解压、实际旧 `v0.2.4-rhine.6` 安装升级、私配／插件配置／Studio 钥匙保留、重复更新／回滚、五附件上传及匿名完整下载校验均 **未执行**。此处的“未执行”限本轮 Windows 包验收，不抹去前述独立本地 HTTP 证据；已有草稿也不等于已上传五个发行附件。

### `.6` 失败后的本地定向证据

卡兹戴尔图标夹具随后在同一次真实 DOM 采样中等待图片 `complete` 与非空 `currentSrc`，没有用合成路径代替图片。Linux Chromium 的原 HTTP 字节／真实自选卡与详情叶用例 **1 项／1 通过／0 失败／0 跳过**，4.257 秒；原图 SHA、自然尺寸 812×876、显示 15×15、高对比滤镜、真实截图及零页面错误均实际检查。这是单叶复验，不代表原生 13 项渲染组重跑成功，原 Windows 失败仍保留。

原版六人另一次本地复验通过真实设置界面对六端选择低画质和官方特效“关”，回读 aria 与持久设置后运行，实际 **1 项／0 通过／1 失败／0 跳过**，230.724 秒。六端真实 Worker load／start 都完成，快照池上限均为 6,240,000，runner `errors=0`，页面运行错误、Worker 失败与 RPC 错误为空；原生批次的空池／runner 错误未在这次本地复验重现。但初始权威座位 1、3 在准备／追帧完成前失去权威，均没有上传；实际接管相对原 `startAt` 为 12.135 秒。替补座位 2、4 与原权威座位 5 的实际上传不能替代三份初始权威上传要求，因此整项仍失败，精确重放门槛未完成。六端仍记录 `highlightTiles` 空对象 `clear` 警告，不能称零场地警告；此机制复验也不覆盖官方特效视觉表现。原 16 倍速、300／150／30 秒期限和初始权威断言保持，该轮未增加预热或放宽生产期限。这些本地结果不改变 Windows 的 43／48 或两轮源码 CI 的失败终态。

原版切换夹具随后等待自选弹窗消失与实际页面隐藏 class 清除，并观测真实点击、请求 rid 与服务器答复。Linux 完整复验 **1 项／1 通过／0 失败／0 跳过**，198.467 秒；新增可见按钮的可信鼠标点击、实际 `room.setRhine` 请求与 `ok` 均通过。原三独立浏览器的配置／Worker 表、三份初始权威上传及 Node 重放、R2、15 秒空闲、真实 reload、引擎 Canvas、最终页面／资源及服务端零错误断言均完成。该成功仍只对应本地 Linux、低画质且官方特效关闭的机制夹具，新版 Windows 尚须独立复验。

两项插件夹具新增失败时的真实服务器／宿主诊断，并在原有等待窗口内捕获实际 MatchProxy，保持 2 倍速、300 秒单项和 120／90 秒观察期限。完整素材 Linux Chromium 在明确记录的 `SP_STUDIO=local` 环境中整批 **2 项／2 通过／0 失败／0 跳过**，165.592 秒。内容插件房主真实结果来自客户端并已送达，伪造内容的队友没有权威上传，由服务器以 timeout 接管；该场默认抽验 `checked=0`，不声称完成重放。沙箱原 `verify=all` 的两份首场真实客户端结果均重放通过，`checked=2`，mismatch／rejected／takeovers 全为 0。两项的实际 Worker、内容集及最终页面／资源零错误门槛均保留；沙箱结算后的两次可选 CDP 诊断各有 5 秒超时，原样记录。这轮未重现旧 Windows 宿主提前结束，不能据本地通过断言 Windows 原因或修复已确认，真实 Windows 专项预检仍须独立记录。

随后临时诊断分支 `813fb4a77df9d66bdc0e520ed1a3ba9a79a011a8` 的 [Windows 专项预检 38887419490](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38887419490) 实际 **2 项／0 通过／2 失败／0 跳过**，206.549 秒，复现了宿主问题。旧包全 25,947 文件、上游清单和 22 个固定表、官方 Windows Node 24.21.0、fresh SES／Acorn 与完整拓展素材先行校验通过；此流程没有构建正式包或写入发行。内容插件宿主已 ready，之后因 `plugin-hang: no heartbeat for 27 s` 被回收，stderr 为空，当时 child 仍 connected、exitCode 为 null。沙箱已进入 COMBAT、两端收到正确 cs 的权威场次，但首次加载阶段 runner 各出现一次错误，随后无 cs 的失败上报被服务器正确拒绝；宿主又因 12 秒无心跳被回收，真实 Worker 条目等待失败。约 15.3／15.7 秒的加载窗口支持加载超时这一假设，日志未打印实际 RPC 错误码，不能据此确定具体方法或把根因定为 CPU／特效。10 秒 watchdog 到 27 秒才执行也说明父巡检调度或墙钟有额外延迟，现有时间均来自父进程的 Date.now，缺少单调时钟与 CPU 测量，不能只归因子进程阻塞。

六人夹具的下一次本地定向复验先在真实大厅逐个创建默认 Worker、加载实际已校验内容后停止，六次实际耗时 0.68–1.13 秒，均未调用 start／创建 Battle、未复用至首战，生产加载期限保持 15 秒。整项仍 **1 项／0 通过／1 失败**，201.370 秒：真实拖放发出正确 UID 的唯一装备请求并收到 `ok`，失败诊断已出现正确的两格信标奖励，但原 10 秒等待未成功；尚未进入正式战斗，不能据此证明预热已解决初始权威上传。旧等待依赖 Puppeteer 默认 RAF，而谓词只读取 store；缺少实际奖励消息到达时间，不能补称奖励已在期限内到达。该失败与此前原生、本地失败均保留，不放宽期限或改记通过。

同一纯 store 谓词随后改为 100 毫秒轮询，原 10 秒期限不变，并记录真实 `m.private` 与等待起止。唯一后续复验仍 **1 项／0 通过／1 失败**，240.680 秒：奖励出现／清除等待分别在 5.441／5.321 秒完成，真实奖励选择与转交通过；六个首战 Worker 的 load／start 都成功，仍缺少初始权威玩家 1 的上传。其 load 在收到首场消息后耗时 11.918 秒，接管消息比 load 完成早 18.3 毫秒，服务器实际在派发约 12.116 秒后启动接管；提前发送构建后的真实零进度也无法挽救这一例。另两名初始权威与一名替补的上传单独记录，不能补足原三名权威断言。预热没有完全消除本地准备／页面调度延迟，未据此继续循环或放宽生产期限。

插件机制夹具另通过真实设置界面选择低画质、关闭官方特效，保持 1600×900、原 CSP 与全部受理／拒绝／真实 Worker 断言，增加被动 RPC 及父进程单调时钟诊断；不改生产设置默认值。Linux 新版完整批次 **2 项／2 通过／0 失败／0 跳过**，174.120 秒。内容插件 `checked=0`、沙箱两场 `checked=2` 的边界保持；实际 load／install／start 均完成且没有 Worker onFailure 记录。四次结算后可选页面诊断仍各有 5 秒超时，不能称所有诊断均返回或据此确定旧 Windows 原因。该机制夹具不覆盖官方特效视觉表现，独立渲染组仍使用原设置。新版 Windows 诊断分支 `8acad2887afaf761e5dc053f971f8d7415cb80e0` 的插件两项与原版六人单项仍须以其实际结果为准。

该分支的 [Windows 专项预检 38889105314](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38889105314) 实际 **3 项／0 通过／3 失败／0 跳过**，两插件 163.122 秒、六人 222.012 秒。低画质与关闭特效没有解决 Windows 故障：内容用例的父进程 1 秒采样实际间隔 16.624 秒，期间父 CPU 仅 110 毫秒；宿主因 17 秒无心跳被判死后，13 毫秒又处理到心跳。该证据确认父进程有真实调度停顿，不能直接把这次判死等同于子进程死锁。沙箱宿主本轮仍健康、诊断可响应，真正失败为两页实际 `load` RPC 分别在 15.165／15.777 秒以 `PLUGIN_WORKER_TIMEOUT` 结束，尚未执行 install／start。六人真实装备请求及奖励生成成功，但已有奖励的纯 store 等待仍超过 10 秒，尚未开战；不称三份权威上传已验证。

六人日志中 GPU 对齐目标值 10 来自测试 Node 的实际 `getPriority(process.pid)`，说明该运行器继承 BelowNormal。依据 [Node 24.21 优先级定义](https://nodejs.org/download/release/v24.21.0/docs/api/os.html#priority-constants) 与 [Windows 调度规则](https://learn.microsoft.com/en-us/windows/win32/procthread/scheduling-priorities)，后续受控诊断将自身验收进程归一到 NORMAL（0），实读校验实际 Node 子进程的继承值，并只将 CDP 确认属于该浏览器的 GPU 对齐到 NORMAL，记录与核对其他进程优先级未改变。该调度假设尚须实际 Windows 结果验证，不能称已确认唯一原因；生产游戏、15 秒加载／2 秒 RPC、10 秒宿主心跳、12 秒首领静默及原 UI 等待期限均不改变。

上述控制在诊断源码 `03ca45bdd401fb5922ec43cad35240dbc27d1d9d` 的 [Windows 专项预检 38891102630](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38891102630) 中实际生效，结果仍为 **3 项／0 通过／3 失败／0 跳过**。helper、自身官方 Node 子进程和两个测试进程均实读为 NORMAL（0），仅所属 GPU 从 -7 调到 0，其他进程优先级保持原值；运行器实际为 4 CPU／4 可用并行度。内容插件仍被宿主心跳巡检回收，判死时覆盖的父采样间隔为 8.457 秒、父 CPU 为 0；之后另有最大 9.034 秒单调时钟 lag。后续处理到心跳不能证明子进程此前连续健康。沙箱宿主本轮仍存活且诊断可响应，但两端真实 load RPC 在 15.292／15.184 秒超时，未到 install／start；其中一个尚未完成的 `/sim/detmath.js` 请求已等待 12.495 秒，这只是加载链路证据，尚不等同于根因。六人已进入真实首场战斗，初始权威为座位 1、2、5；座位 1 的 load 在 23.919 秒超时、没有上传，座位 2、5 的真实成功上传不能补足原三份初始权威要求。另三名非权威玩家也各发生一次 load 超时。本轮确认优先级调整不足以解决问题，没有按相同设置再次运行，也未将诊断分支推到正式主线或公开任何新安装包。

后续源码检查发现：原 `ensureSim` 对隔离模式只缓存内容描述，原“预热”注释对应的 Worker 实际要等 `b.start` 后才创建和加载。修正将真实 load／install 提前至 INFO_CHECK 和准备阶段，使用一个尚未 start 的隔离 realm；首个同内容战斗只领取一次，用过的 realm 不归还。跨回合、离房、配置／内容／同意状态变化和异步迟到均有失效检查；正常战斗到联防之间没有准备阶段，该额外 Worker 仍可冷启动。四个完整 runner／host 回归文件最终 **48 项／48 通过／0 失败／跳过／取消**，31.242 秒，其中新增十项覆盖领取竞争、取消、失败只记录一次、真实 Worker 与全新 realm 的精确对照、闭包状态隔离、原 2 秒无限 setup 终止，以及真实 runner 生命周期和撤销同意。没有新增健康 RPC、合成战斗进度或放宽生产时限；显式同意的 trusted native 在无待处理 RPC 的闲置阶段仍没有连续 watchdog，完整边界见 SIM.md。

机制夹具另改为一台真实浏览器、每名玩家一个独立 BrowserContext，保留全部真实页面、viewport、Worker、CSP、游戏操作与断言；三客户端配置切换及独立渲染组仍保持原独立浏览器配置。Linux 短对照实验中，六个独立 Context 的六页均为 visible、有持续 RAF、独立 cookie／localStorage、健康 WebGL，GPU 为 1 个；六个独立浏览器为 6 个 GPU。实际 Client 短探针还检查关闭一个 Context 后其他玩家和共享浏览器仍存活，reload 保留两个文档的可见性／RAF 历史，最终由 pool 唯一关闭浏览器；第一次短探针只在辅助 HTTP header 元数据读取处失败，修正真实观测后通过，失败没有改记成功。原六人夹具额外创建后停止的临时 Worker 暖缓存已移除，后续整合将验证生产预加载。以上短实验不等于完整游戏或 Windows 已通过；新版实测仍须独立完成。

随后同一冻结生产预加载与独立 Context 源码的 Linux 原版六人整合实际 **1 项／1 通过／0 失败／跳过／取消**，176.613 秒。原 16 倍速、300 秒单项、150 秒 RESULT、30 秒实际池和 10 秒奖励等待保持；六名真实玩家、信标发放／选择／转交、真实 reload 不重复奖励、六端本地双倍池、三份初始权威上传及各自真实共享池时间线的 Node 精确重放、六端零模拟错误和六人 RESULT 均执行通过，页面／控制台／资源及服务器 mismatch 错误门槛也通过。房主真实引擎 1280×720 的几何检查打印当时场地警告为空，不扩大为全程六端零场地警告。六页最终及已观察文档始终 visible，reload 客户端保留两个文档的真实 RAF 历史；其最大 RAF 间隔仍达 22.782 秒，不能称画面流畅或完全没有停顿。成功场次原始上传未额外转储，重放结论来自执行通过的测试断言，不另称第二次独立事后复验。此轮只选择原版单项，不能代替两种配置全组或真实 Windows 验收，也不抹去此前全部失败。

诊断源码 `a9f806444975f2a6072f15a943f4c89cea4d1301` 的 [Windows 专项 38894407571](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38894407571) 随后实际为 **3 项／2 通过／1 失败／0 跳过**。Edge 154.0.4258.62 上两个插件完整通过：内容插件 95.242 秒，沙箱 64.916 秒，均使用一个实际 GPU、各自独立 Context；四页最终可见性／RAF 均通过。房主 load 2.236 秒、start 0.235 秒，沙箱两端 load 3.066／3.251 秒、install 20／16.6 毫秒、start 201／193 毫秒，实际领取同一个预加载 Worker。内容插件仍只默认抽验 `checked=0`，不能称完整重放；沙箱两份真实客户端结果均 delivered、1501 ticks／50.033 秒、errors=0、`checked=2`，mismatch／rejected 均为 0。此两项旧宿主心跳中止未重现；父进程最大 lag 1.422／2.880 秒，模块 HTTP 780／1162 请求均完成，最慢 87.74／107.95 毫秒，这些采样只覆盖两项插件，不套用至独立子服务的六人用例。

该轮原版六人仍失败，93.993 秒：座位 1–5 的真实预加载在首次 R14 战斗前约 32–35 秒发生 15 秒 load 超时；缺少早期 observer，尚不能确定坏槽属于 INFO_CHECK 的 round 0／1 或 R14 PREP。三名初始权威为座位 1、2、3，收到首次本地开始后约 3 毫秒便接管，`battles=0`、空池和 forced／time=0 不是成功模拟；后续座位 4、5 成功加载及座位 6 的正常 start 不能替补三份原始上传。此用例仅六页初始可见性通过，最终可见性及完整 replay 尚未执行。VM 的组前后 CPU 累计差分显示约 92.97% 忙，RAM 端点仍有约 12.8 GiB 空闲；这不是每进程／峰值采样，也未证明 GPU 是唯一根因。

后续仅复验剩余六人单项：Windows Node 保持 NORMAL，仅将经 CDP 核实归属的 GPU 从 NORMAL 降至 BelowNormal（10），实读并断言其他进程未改；Linux 原 nice 15 不变。独立早期 observer 按每文档幂等记录真实 load／install／start RPC、原 Promise、当时配置／阶段／回合，并在 reload 后保留旧历史，不重建或清空原战斗 trace。原十处计时及 16 倍速表达式经 AST 比对保持，全部错误、实际池、三初始权威上传和精确 replay 断言保留。

该受控诊断源码 `78412f66115fc41fa94b9b3f0d42964c76220c77` 的 [Windows 专项 38896338704](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38896338704) 实际 **1 项／0 通过／1 失败／0 跳过**，86.932 秒。早期观测记录六个 Worker 在 INFO_CHECK／round 0 的 57 毫秒内同时开始 load，7.902–8.393 秒后进入 ROUND_START／round 14 时全部以 STOPPED 取消；第二代六个 load 在 14.339–14.828 秒后随房间退出比赛再次取消。没有 TIMEOUT、完成的 load／start、战斗或初始权威；六端 `errors=0` 只是本次有意取消未计作错误，不能称模拟通过。整机累计差分约 50.36% CPU 忙、两端点空闲 RAM 约 11.8／12.5 GiB，不能称本轮整机饱和或证明 GPU 调度已解决问题。原服务静默日志没有保留房间提前结束的真实原因，尚不能归因宿主心跳或同步布局。

针对已证实的生命周期问题，后续生产修正从已完成内容校验且满足脚本同意的真实大厅开始加载；健康且尚未 start 的同一 realm 保留到首个实际回合，包含 round 0→14，原 Promise 与 15 秒 load watchdog 不重置。round 仅允许失败闲置槽在后续准备回合重试一次，旧错误保留；用过的 realm 不回池，结束／新局、离房、内容／配置／同意变化和异步迟到继续隔离。四个完整 runner／host 文件 **54 项／54 通过／0 失败／跳过／取消**，29.685 秒，文档 **32／32**；新增六项覆盖大厅与首跳回合、同 Promise、失败重试代际、结束新局和迟到竞争。上述本地六人成功属于先前源码，不能替代此修正后的 Windows 实测。

剩余六人夹具另以显式测试旗标启用有界、被动的服务端日志，保留真实 MatchProxy／host、心跳／退出原因和父进程单调 lag／CPU；同步 `startRound`／`enterPrep` 及逐玩家 `planLayout` 只加入起止标记，布局、RNG、游戏及 watchdog 期限保持。Linux HTTP 健康启动／优雅关闭短探针通过，未执行比赛或 GPU；Windows 强制终止不能保证 JS 关闭 handler 执行，主动日志和采样不依赖该 handler。

新源码 `4427e8e90b4355d47684197784e0ef75709f2506` 的 [Windows 专项 38898607012](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38898607012) 随后实际 **1 项／1 通过／0 失败／跳过／取消**，228.766 秒，原版六人单项 227.795 秒。八个实际生产／夹具文件与本地源码、临时分支及 Windows 打印 SHA 全部匹配。六个大厅 load 分别 2.516／2.211／2.086／2.200／2.126／1.540 秒；末端真实 reload 后以全新文档／realm 在 R14 加载 5.375 秒，其余五端保留原大厅加载实例到首次 start，六个实际 start 为 27.8–45.1 毫秒，零 RPC 失败。六个最终页面及已观察文档可见性检查通过，reload 历史包含两个独立文档。

原 16 倍速与全部期限保持，真实信标发放／使用／转交、reload 不重复发放、六端实际双倍池与零模拟错误、三份初始权威真实上传及各自实际共享池时间线的 Node 精确重放、六人 RESULT，以及页面／控制台／资源与服务器 mismatch 门槛均执行通过。成功日志没有另行转储 starts／uploads／digest／实际池数值，以上结论来自冻结源码中执行通过的原断言，不额外声称第二次独立事后重放或反推出初始权威席号。成功场次没有打印服务端诊断 ring，不能据此补填父 lag／布局耗时，也不能反推上轮房间退出的原因已确定。此轮没有重跑先前已通过的两个插件用例，完整 Windows 安装包与全部 48 项浏览器仍待新候选独立执行；旧失败全部保留。

### `.7` 完整原生 Windows 验收

正式元数据 `923f8243301c9adc0d51b0ab95d2980d14521ac2`、不可变源码 `a2a29afe592dd3cf0a156b65bd4e232df1f9fdf4` 的 [Windows 发行任务 38899986209](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38899986209) 实际 **failure**，未公开。真实 Windows x64／包内 Node 24.21.0 主回归 **974 项／972 通过／0 失败／2 条件跳过**，172.935 秒；作者／Studio **27／27**，94.549 秒，隔离宿主 **9／9**，57.422 秒；全部取消数为 0。两条主回归跳过仍是未启用可选 `SP_ASSET_E2E` live 下载及便携／浅克隆缺固定 Git 对象，准备步骤已独立实际校验旧包 25,947 文件、上游清单及固定快照。新增 runner 四文件也在真实包内执行通过。

全部 11 个浏览器组均实际执行，合计 **48 项／46 通过／2 失败／0 跳过／0 取消**。上游 UI 为 8／7／1，插件／Studio 为 4／3／1，其余九组共 36／36。图标所在 13 项渲染组全过；莱茵与原版六人分别 184.525／173.594 秒，真实引擎 Canvas 1280×720、几何 source／target 均在范围内，观测时 `fieldWarnings=[]`，未采用 fallback；这不是全程帧率流畅的声明。内容插件房主首场结果由客户端送达，伪造内容的队友由服务器接管，`checked=0`；沙箱两份真实首场客户端结果均送达，`checked=2`、mismatches／rejected 为 0。

配置用例失败于 `rhine-profiles.e2e.test.js:351`：真实 trusted pointer／click 的目标为 DIV，所选按钮当时 computed visibility 为 hidden，`room.setRhine` 请求和答复均为空，原 30 秒请求观察超时。旧宽松点击辅助允许包含按钮的祖先 DIV 命中，未证明按钮本身可点击；日志没有完整祖先样式，不能指定某个残余 class／transition 为唯一原因。Studio 第一例失败于 `studio-gameplay.e2e.test.js:47`：点击保存后 30 秒内未观察已保存 `normal.atk=900`，尚未进入该例的 trial／replay；旧日志未记录输入值、保存按钮状态或 API，不能断言 disabled／draft 竞态已被证实。DSL 第二例通过。失败门槛阻止后续 HTTP／WebSocket、最终 ZIP 压缩／重解压、实际旧包升级／私配保留／重复更新／回滚、五附件上传下载与公开；这些尾段本轮均未执行，不能把草稿或源码审查记为通过。

后续仅修正上述两个真实 UI 夹具：配置关闭原 5 秒与点击原 15 秒预算内校验按钮／祖先可见性及严格实际命中，再发送一次可信鼠标点击；原 30 秒请求、三独立浏览器及全部 59 个原断言保持。Studio 输入 900 后，原 30 秒等待预算由保存就绪与保存状态等待共享；实际 CDP／鼠标操作仍受原个测和协议期限约束，不称绝对 30 秒墙钟上限。另检查真实 POST、HTTP 回应及磁盘内容，180 秒个测和全部后续试验／双渲染回放／比较／打包／iframe 断言保留。生产游戏和公共 Client 不改。纯 DOM 形状模型 18／18 通过，不等同真实 CSS 引擎；Linux Studio 完整第一例 **1／1**、29.020 秒，实际可信保存一次、POST 900／HTTP 200、磁盘属性及原借用 kit 正确，后续原断言均越过；不反推旧 Windows 失败原因。完整配置及新的 Windows 两项专项结果另记，旧失败不改写。

发行自动化对独立浏览器组继续执行各自的原断言、原期限，收集所有组结果后统一拒绝失败候选，避免一个夹具错误掩盖后续问题。任意一组失败仍禁止压缩、升级验收和公开发布；全部通过后的报告格式及五附件校验要求不变。

源码验收不代替 Windows 安装包验收。发行流水线必须在真实 Windows x64 使用包内 `node.exe`，安装 .3 锁定依赖并包含 SES／Acorn、插件／Studio 和 local-fx；执行包内回归、完整素材 Edge 浏览器、HTTP／WebSocket、从实际 `.6` 包升级、私人配置及插件配置／Studio 钥匙保留、重复更新、回滚，以及附件重新下载 SHA256 校验。只有发行门槛通过才公开，实际结果以发行附件 `RELEASE-VALIDATION.json` 为准。

未做真人完整多人平衡试玩或人工 BAT 点击验收，未部署用户服务器。整体游戏内阵营描述改写和变形同构体无限库存均不在本轮。

展示名称改为“阵营拓展”，README 重点补充雷姆必拓并保留其他阵营介绍。仓库 slug／地址、安装目录、启动文件、升级渠道和任务名称保持不变。仓库 About 的 PATCH 写入被当前 API 通道以 `Forbidden` 拒绝；再次读取确认仍为旧简介，README 更新不代表 About 已更新。

### `.7` 最终源码 CI

不可变源码 `a2a29afe592dd3cf0a156b65bd4e232df1f9fdf4` 的 [tag CI 38899984904](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38899984904)，以及仅相差发布请求文件的正式元数据 `923f8243301c9adc0d51b0ab95d2980d14521ac2` 的 [主线 CI 38899986092](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38899986092)，均为 **failure**。以下为封存日志的完整测试汇总；Node 22 实际为 **22.23.3**，Node 24 为 **24.21.0**，耗时按秒取三位小数。

| 引用 | 环境 | 项目／通过／失败／跳过 | 测试耗时（秒） | 结果 |
| --- | --- | --- | ---: | --- |
| tag | Ubuntu Node 22 | 8540／8444／1／95 | 2054.748 | failure |
| tag | Ubuntu Node 24 | 8540／8445／0／95 | 1093.269 | success |
| tag | Windows Node 22 | 8540／8451／4／85 | 2474.307 | failure |
| tag | Windows Node 24 | 8540／8455／0／85 | 2138.402 | success |
| 主线 | Ubuntu Node 22 | 8540／8443／2／95 | 2086.133 | failure |
| 主线 | Ubuntu Node 24 | 8540／8445／0／95 | 1077.418 | success |
| 主线 | Windows Node 22 | 8540／8450／5／85 | 2548.718 | failure |
| 主线 | Windows Node 24 | 8540／8455／0／85 | 1547.258 | success |

八个任务取消数均为 0。两个独立 tooling 任务均通过 lint／导入边界／类型检查，lint 各为 **0 error／151 warnings**。四个 Node 24 任务随后实际通过服务器 smoke；四个 Node 22 任务的 smoke 因前步失败而跳过。

Node 22 中，tag Ubuntu 的 1 项、主线 Ubuntu 的 2 项及两个 Windows 各 3 项失败，直接日志均为 `plugin-host.test.js` 的 `timeout waiting for any`，堆栈止于 `wsClient.js:106`，约 2.34–2.50 秒。固定源码及近期帧序列支持 `room.setPlugins` 默认 2000 毫秒请求发生于房间设置阶段的推断；异步调用者没有打印在该堆栈中，不能把这个推断写成日志直接证明，也不能据此声称真正 watchdog／OOM 注入或验证行为已执行成功。两个 Windows Node 22 还各有一次真实 SES 全机器人对局失败：`sandbox-host.test.js:61` 收到 `plugin-hang`、分别 10／11 秒无心跳，`victory` 为 undefined；这是实际对局故障，区别于设置等待超时。上述签名曾在旧轮出现，但签名相同不证明根因，也不排除回归。

主线 Windows Node 22 另有本轮新观测的性能门槛失败：`test/sim/perf.test.js:57` 的最坏场景测得 **0.5059190833333336 ms/tick**，要求 **< 0.5 ms/tick**。它不归入旧超时失败，也没有证据确定为 CPU 原因；不同 GitHub Actions 任务运行于独立 VM，不能称它们共用 CPU。本轮没有记录新的 runner／prewarm 失败，但不能因此称全部源码矩阵通过。

六个更新／发行校验文件按固定源码逐标题映射，共 **98 项**：`rhine-bundle-update` 28、`rhine-online-update` 28、`rhine-update-boot` 5、`update-boot` 10、`update-package` 11、`tools/verify-rhine-release` 16，无重名或未映射标题。四个 Windows 任务均 **97 通过／0 失败／1 条件跳过**，四个 Ubuntu 任务均 **94 通过／0 失败／4 条件跳过**。所有任务均跳过需显式开启 `SP_UPDATE_E2E` 的 CLI rollback 用例；Ubuntu 另跳过三项 Windows ZIP／BAT 专用用例，这三项在四个 Windows 任务均实际通过。源码 CI 及这些夹具结果不替代安装包升级／私配保留验收，也不改变前述 `.7` 原生发行失败终态。

### `.7` 后配置与 Studio 的两项专项

严格配置点击夹具在 Linux 三独立浏览器完整 **1／1** 通过，193.730 秒，实际点击目标为 BUTTON；原 59 个断言包含真实切换 ACK、三份普通战斗上传及 Node 重放、引擎 Canvas、reload、15 秒空闲和最终零错误，均执行通过。随后冻结诊断源码 `5aef1d912a74115dad833a87b2bd01d4d61f0131` 的 [Windows 专项 38904452488](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38904452488) 仍为 **2 项／0 通过／2 失败／0 跳过／0 取消**。配置点击及真实 ACK 已通过，三端普通战斗实际上传均记录 errors=0；但顺序校验只完成首位 vanilla-host 的普通战斗 Node 重放，便在该端 runner 零错误断言失败。其普通战斗后的 UNITE 冷 Worker load 耗时 19.507 秒，真实触发原 15 秒超时；另两端重放、reload 及最终门槛未触达，不能补称全部完成。guest 的 UNITE load 15.097 秒和 start 3.676 秒实际返回 done，之后清理的 STOPPED 不改记超时。原 Windows GPU 为 NORMAL（0），现有日志不能证明 GPU 是唯一原因。

同轮 Studio 输入已为 900、保存按钮可用，观测点 y858 在视口内；随后的 ElementHandle 隐式滚动未完成真实点击，失败时按钮 top1137 超出 1000 高视口，无保存 POST、磁盘仍 410。随后 Linux 坐标点击修订仍 **1 项／0 通过／1 失败**，33.484 秒：唯一显式滚动后的稳定目标一直未满足，尚未移动／点击鼠标或发 POST。实际两个目标列表请求在输入 900 后 15／19 毫秒才返回，列表高度增长使保存按钮再次下移；这一观测不反推更早 `.7` 无诊断日志的确切原因。

最小就绪修正先在同一原等待预算内等待两个真实列表非 busy 且有目标，再唯一显式滚动、跨 RAF 复核稳定实际命中点并发送一次 mouse.click，不改产品 CSS、视口或期限。冻结 Studio 文件 SHA256 `95ac02afa8295265c8ac9052f91c824265efcfe77070e72e94e1d7b9bebb24e3` 的 Linux 第一例随后完整 **1／1** 通过，29.804 秒：两列表各 60 目标、高 300，唯一可信保存点击实际 POST 900／HTTP 200，磁盘为 900 且原 kit 保留，全部原试战／双 Canvas／重放／比较／打包下载／iframe 门槛完成；DSL 第二例未选择且源码不变。

配置夹具另仅在 Windows 将 CDP 归属确认的本浏览器 GPU 设为 BelowNormal（10），实读核对 Node 始终 NORMAL（0）及其他存活所属浏览器／renderer 优先级不变；Linux 原 nice 15 保持。三独立浏览器、20 个原 timer／wait 表达式、原 59 个断言及真实冷 UNITE 路径保持，新增归属和调度硬断言；7／7 纯 VM 模型探针不是原生 Windows 实测。新两项诊断源码 `6c74d36f7bf18397102477f5b1a529b430b3bca2` 已送入 [Windows 专项 38906606052](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38906606052)，结果须据实际终态另记。该只读权限诊断流程不制作安装包、不写发行、不部署服务器，不代替正式 48 项与升级尾段。

该专项随后实际 **2 项／1 通过／1 失败／0 跳过／0 取消**：Studio 完整第一例 **1／1**，33.113 秒，原后段试战／双渲染回放／比较／打包／iframe 及新增真实保存断言均通过；本轮未选择 DSL 第二例。配置仍 **failure**，128.867 秒，三个 GPU 实际从 -7 调至 10、Node 均为 0，其他实读所属进程优先级不变；这一控制不足以通过门槛。vanilla-host 的 UNITE 冷 load 耗时 20.995 秒、报原 `PLUGIN_WORKER_TIMEOUT`（15000 ms）；guest 同类 load 1.768 秒、start 25.3 毫秒成功。三端普通战斗上传 errors=0，仍仅首位 vanilla-host 的普通战斗 Node 重放完成便在 `:557` 的 runner errors=1 断言失败，后两端重放、reload 和最终门槛未触达。失败诊断还显示 guest、Rhine 两页已降为 fallback、无 Canvas，均记录 `createFieldView timed out`；只有 vanilla-host 当时为真实 1920×1080 引擎且 warnings 为空，不能称三端引擎成功。未重跑同条件，也没有据此认定 GPU 或生产生命周期为唯一原因；公开版仍未变化。

两项独立只读源码审查确认，超时 UNITE 的新 Worker 在收到战斗消息后约 2.8 毫秒已发出首条 load，尚无 start／step 排队、取消或重复 load 的证据；测得时长包含消息传递、加载及页面处理响应／计时回调，不能等同 Worker CPU 耗时。随后仅机制夹具复用现有 BrowserContextPool，三个真实玩家各自独立 Context、页面模块、存储与模拟状态，共用一个浏览器／GPU；原 59 个断言、已加就绪／调度断言及 33 条 timer／wait 调用 AST 均保留，新增 cookie／localStorage／sessionStorage、三个真实身份、目标 reload 文档独占及真实可见性／RAF 历史检查。生产 Worker 池、冷 UNITE、2 倍速和全部时限不变；这种资源拓扑通过也不能称旧三独立进程压力故障已修复，专门渲染套件保持原设置。

冻结 profile 文件 `4b631614972f24cc162f8dcba0139a243548e5bbb7cc3e0dffdbe6c82f127a6a` 的唯一 Linux 整项仍 **1 项／0 通过／1 失败**，255.766 秒：三端真实普通战斗上传及每份 Node 精确重放、R2 runner errors=0、两个 reload 的身份／存储／其他文档不变检查均已通过，但最后原房主 reload 后 Canvas 的 30 秒等待失败。诊断中房主为 fallback、无 Canvas、`createFieldView timed out`，另两页为真实 1920×1080 双 Canvas、contextLost=false、warnings=[]；不能称整项或最终可见性／页面错误门槛通过。未完成 `/healthz` 请求 age65.862 秒只是页面观测，不证明服务器 CPU 阻塞。原 1920×1080 的三个画面仍有较高软件渲染负荷，下一受控变量评估显式 1280×720 桌面夹具（像素数为原 44.44%），参照此前真实六人单 GPU 的同尺寸机制验证；不以改超时、跳过重放或接受 fallback 来通过。

显式 1280×720 桌面没有跨过原房间／自选界面的响应断点，新增实际尺寸回读，全部原 88 个断言表达式保留（现 91），33 条 timer／wait AST 相同。冻结文件 `47d13dbebac50dc30036f95d32415d8a33288b639cb7e73c118fafb11ea65a89` 的唯一 Linux 整项依旧 **1 项／0 通过／1 失败**，180.422 秒，在原 `:648` 的房主 reload Canvas 等待失败；三份普通战斗上传／Node 精确重放、R2 runner errors=0 与两次 reload 隔离均先通过，最终可见性／页面错误门槛未触达。房主仍 fallback，另两页实际双 1280×720 Canvas、contextLost=false、warnings=[]；不能称减像素已解决 Linux 故障。该源码独立送入诊断 `4293615aae3c2b8721e76ccdbc79dc6a82952254` 的 [Windows 剩余单项 38909342655](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38909342655)，单独检验目标发行环境；Studio 已通过的相同源码不再重复，完整发行仍须重跑全部 48 项。

该 Windows 剩余单项实际 **1 项／0 通过／1 失败／0 跳过／0 取消**，177.081 秒，也失败于 `:648` 的房主 reload 后原 30 秒 Canvas 检查。三端普通战斗真实上传、三次 Node 精确重放、三端 R2 runner errors=0 和两次实际 reload 的独立上下文／身份／配置／存储检查均已完成；随后房主 fallback、无 Canvas、`createFieldView timed out`，另两页实际 engine 且 warnings=[]。最终 RAF 历史及综合页面／服务端错误检查尚未执行。真实单浏览器／单 GPU／三独立 Context、1280×720 与 Node=0／GPU=10 均有日志，不能把通过的战斗断言扩展成整项通过。host reload 后旧文档 RPC 轨迹已丢弃，不能据错误数为 0 编造此前 UNITE 的单独加载耗时；guest UNITE load 8.201 秒、start 2.027 秒实际 done，清理时的 STOPPED 单独保留。下一测试变量是共享 GPU 的 NORMAL 优先级，并记录被动资源时序；仍不修改生产加载／执行／渲染时限。

共享 GPU 恢复 NORMAL 的文件 `513c5c2ce414be94d5517b0b80620a942d7fbe64b16b69bb203f27217ab366c0` 保留所有机制／UI／隔离／上传／重放／Canvas／零错误断言及 33 条 timer／wait AST；调度断言按新变量将 Windows 目标 10 改为 0，并随 Linux 全部优先级写入删除旧线程 nice15 断言（91→90），不冒称旧调度断言逐字相同。Linux 只实读默认 GPU=0，不修改任何进程／线程；Windows 只把 CDP 所属 GPU 从 -7 调为 0，Node=0 和其他存活所属进程不变。9 项纯 VM 契约通过不等同实际性能证明。

该文件唯一 Linux 整项 **0／1**，172.463 秒，[Windows 专项 38911311460](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38911311460)（诊断源码 `34067fa23a97c876a51b4bf203af203e43147792`）同样 **0／1**，194.232 秒，均在原 `:660` 的房主 reload 后 Canvas 30 秒等待失败。此前三份正常上传／Node 精确重放、三端 R2 runner errors=0、两次真实 reload 隔离已通过；最终可见性历史／综合错误门槛未触达。另两页为 engine、warnings=[]，房主 factory12s 失败进入 fallback。GPU 正常优先级未解决此问题，不能继续归为已证 GPU 根因。

新增被动 ResourceTiming 只扩大记录容量至 5000，最多输出 120 条筛选资源，不预加载或改请求。Linux 新房主文档共 385 条／筛选 88 条，样本最长 203.4 毫秒、pending=[]，实际 visible、836 RAF、hiddenFrames=0，但最大 RAF 间隔 8.9997 秒；缓存的 three.module 在 5.0112 秒完成获取，静态依赖 three.core 到 14.0022 秒才开始，这个间隔不是 9 秒网络下载，也没有证明 JS code cache 命中或某个具体同步栈。Windows 为 387／88 条，样本最长 74.6 毫秒、最后筛选资源在 4.424 秒完成，visible、1650 RAF、hiddenFrames=0，最大 RAF 间隔 5.4997 秒。筛选样本不覆盖全部资源、模块执行或 WebGL 初始化，catch 的空 Canvas 也可能是正常 abort 释放后的状态。下一诊断只在真实房主最后 reload 前启用可选 CDP CPUProfiler，保留原门槛与源码执行，用采样定位初始化调用栈；不再盲调画面尺寸或优先级。

### 实际 CPU 采样与纹理拷贝诊断

可选诊断只在最后房主真实 reload 前启用 CDP CPUProfiler，默认发行验收不开启；profile 文件 `caf112ad` 保留原 90 个断言、33 条 timer／wait AST、300 秒个测及现有画质／隔离。独立真实 reload 小探针的最初“NavigationStart 必须位于 profile 内”断言实际失败，原记录保留；同一原始数据离线复核仍含新文档已知函数 264 个 self samples，282 个样本在新文档交集，profile 从导航后 5.795 毫秒开始。因此只能证明实际采样交集，不称捕获了导航瞬间或整个探针进程通过；没有重写时间字段或重跑掩盖原失败。

Linux 唯一完整诊断仍 **1 项／0 通过／1 失败**，179.070 秒；[Windows 诊断 38913793523](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38913793523) 同样 **1 项／0 通过／1 失败／0 跳过／0 取消**，236.491 秒，均在原 `:663` 的 reload Canvas 等待失败。此前三份普通战斗真实上传／Node 精确重放、R2 runner errors=0 与两个 reload 隔离检查已通过，最终 Canvas／RAF 历史／综合错误门槛没有通过。Linux 原 CPU profile 418415 字节、SHA256 `85e92ec40c88dbc05b5720399e6306e051696d52c603938a427959a9b0186700`，Windows 为 497708 字节、SHA256 `2ec4099a4826693bdb5ef236e9072327741c57c3ecad60c78ddd09b391085951`；两者 gzip、分块、字节数和原始 SHA 均独立核验。

Linux 采样未覆盖新文档最初 1.349 秒，Windows 采样窗口从导航后 2.327 秒开始、首个实际样本为 2.576 秒；Windows 原有 -30／-74 微秒的两个负 delta 原样保留。采样命中数不是调用次数或 CPU 毫秒，累计 delta 区间也不是线程 CPU 耗时；采样包含失败后的诊断及销毁操作。Linux 的 `createFieldView → TileField → tileAtlas → MATERIALS.forEach → drawImage` 栈为 1740 个 self samples，位置分布于导航后 11.115–15.406 秒；对应 47 种材质在同一 2048² atlas 上依次扩展上下、左右四条边，代码源矩形很小，不能声称代码要求复制整张 atlas，或据 profile 断定浏览器具体 native 实现。另有 Pixi 支持探测、真正 context 创建、扩展及 batch 能力 shader 查询；首次 ticker 的 program／uniform 查询也属于 Pixi。超时后的 `loseContext` 是释放路径，不能当作初始化原因。

下一最小候选只评估复用 256² cell 画布完成原内部和四条扩边，再整数坐标 1:1 拷入总 atlas，保留材质顺序、种子、UV、透明度、美术层、缓存和渲染 ready／取消契约。必须先比较真实 Canvas 的全 atlas RGBA 像素及真实美术，再执行关闭 profiler 的完整场景；本段不把尚未完成的优化或后续验收记为成功。

首版 256² cell 全部重绘候选 `6ca43b9b` 的真实 Chrome／SwiftShader AB 像素探针实际失败，未执行 BA，也未降低容差：每张 4,194,304 像素，procedural 差 1,508 像素／2,445 通道，最大差 4；真实美术差 1,516 像素／2,455 通道，最大差 3，artCount 均为 40。差异主要在 infection／infection2，另有少量其他材质；UV、artCount、缓存命中／淘汰均一致。单次墙钟绘制观测 old procedural／art 为 1079／1129 毫秒、candidate 为 71／44 毫秒，不能用这一观测替代像素等价或完整初始化验收。探针还记录一个 favicon 404，不称零资源错误。浏览器和临时 HTTP 均在 finally 关闭，baseline 只在内存，无临时美术文件；该候选暂不采用，尚未送入新的 Linux／Windows 完整专项，也未推正式主线。

改为只在 256² scratch 处理边缘的第二版 `a18cfc95` 保留原 atlas 全局内部绘图，再只写回四条互不重叠的 gutter。真实 Linux Chrome 151／SwiftShader、1280×720、Node／GPU 优先级 0、默认 2D context（没有 `willReadFrequently`）执行 AB 与 BA 两种顺序；每种均比较 procedural、真实美术及 art replacement 三张 2048² atlas，合计 **25,165,824 像素逐 RGBA 全部零差异**，内部、上下左右与四角分别累计也为 0。UV、alpha、artCount（0 或 40）、缓存命中及旧 art 淘汰一致，真实美术包含 alpha／rotation／tint 层。两序中的程序构建墙钟样本由旧 962–1083 毫秒降为 69–75 毫秒，真实美术由 973–1090 毫秒降为 48–84 毫秒；这不包含后续 GPU 上传，也不作平台通用性能或完整初始化通过声明。临时 favicon 改答 204，两序 errors=[]；旧版 favicon 404 和像素失败原样保存在独立 v1 证据。

第二版通过现有 tiles／boardart／originium-art **26／26**、fieldHost lifecycle **5／5**，语法及 diff 检查通过；该文件 lint **0 error／6 warnings**，六项均与精确 `a2a29afe` 基线相同。probe 的浏览器、GPU 和 HTTP 已实际退出，无临时美术。完整 Linux 配置专项及新诊断源码 `23712ca9893f733a4e7b671c17bae82c63421255` 的 [Windows 专项 38916658418](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38916658418) 均关闭 CPUProfiler，并保持全部原期限与断言；其终态另记，本段仅证明已完成的像素／定向检查。

关闭 profiler 的第二版唯一 Linux 完整专项实际仍 **1 项／0 通过／1 失败**，167.136 秒：三份正常上传／Node 精确重放、三端 R2 runner errors=0、两次 reload 隔离均先通过，但房主 reload 后原 `:663` Canvas 30 秒检查失败，factory 12 秒后进入 fallback。该文档实际 visible、913 RAF／hiddenFrames=0、最大 RAF 间隔 5.2164 秒、pending=[]；另两页为双 1280×720 引擎 Canvas、contextLost=false、warnings=[]。最终 Canvas／可见性历史／综合错误门槛未通过；代码四个 SHA 前后不变，浏览器及 FastServer 已退出。atlas 像素等价及短调用加速没有解决这一整项故障，Windows 目标环境独立结果仍须据新专项终态判断，不据 Linux 结果猜测。

同一第二版的 [Windows 专项 38916658418](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38916658418) 也实际 **1 项／0 通过／1 失败／0 跳过／0 取消**，248.757 秒、个测 245.507 秒；计划明确 CPUProfiler=false，环境没有启用标志，日志无 CPU 采样。实际 Node／GPU 均为 0，前三份正常上传／Node 精确重放、R2 runner errors=0 和两次 reload 隔离均先通过，仍在 `:663` 的房主 reload 原 30 秒引擎 Canvas 等待失败，factory 12 秒后 fallback。房主实际 visible、1584 RAF／hiddenFrames=0；最终 Canvas／RAF 历史／综合错误门槛未通过。此正常运行独立于采样诊断，证实纹理局部优化未解决该环境默认 3D 的整项冷启动问题。

源码只读审查确认项目已有 [部署文档](DEPLOY.md) 的 `/?board=2d` 入口：它仍创建真正 Pixi Application、atlas／Spine 与独立模拟 Worker，由 fieldHost 标记为 engine；仅跳过 3D 支持探测、Three context 和 boardReady 等待。当前配置切换用例没有 3D 专属或第二 Canvas 断言，机制目标为配置／内容集、真实模拟上传与重放及身份隔离；因此下一机制夹具明确选择已有 2D 棋盘并增加实际 URL、engine 和 `board3d.on=false` 核验，保留原 Canvas、全部机制断言、reload 与期限。guest 的 room 参数与两个 reload 的 board 参数都须真实保留，专门 3D／渲染套件保持原设置。这是验证范围的明确调整，不是默认 3D 多页面软件渲染冷启动故障的修复；该限制保留，尚未据此运行结果称任何新专项通过。

这一 2D 机制夹具冻结为 SHA256 `1b36891568bdd963eeb2a9e2e381924b229b022dc0b729893722f3866c68b7aa`：原 90 个断言表达式逐字保留、现 94 个，新增真实 URL、reload 保参、engine 及实际 `board3d.on=false` 检查；原 33 条 timer／wait AST 无增删改。语法、定向 lint、diff 及独立只读审查通过；公共 graphics helper 与游戏代码不改。唯一 Linux 正常全项及诊断源码 `6c846fb9d6fd3e664add0645338408364808519d` 的 [Windows 机制专项 38918125810](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38918125810) 均不启用 CPUProfiler，实际终态另记。

该 2D 机制路径唯一 Linux 完整专项实际 **1／1 通过、0 失败／跳过／取消**，113.666 秒（个测 113.035 秒）：三份真实正常上传及 Node 精确重放、三端 R2 runner errors=0、两次 reload 的 Context／身份／cookie／localStorage／sessionStorage 隔离、原最终 Canvas 等待、所有文档可见／RAF 历史及最终页面／资源／服务器零错误门槛均越过。末段三页均 actual kind=engine、renderer=true、contextLost=false、board3dOn=false、单张 connected 1280×720 Canvas、fieldWarnings=[]。94 是静态断言调用表达式计数，不冒称 Windows 专属调度分支或 catch 诊断分支在 Linux 执行；该平台所有适用门槛实际完整通过。四份源码 SHA 前后一致、CPU 标志 unset／日志无采样，浏览器及 FastServer 实际退出。这个通过不改写之前两平台默认 3D 路径的失败。

[Windows 机制专项 38918125810](https://github.com/YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine/actions/runs/38918125810) 的同一冻结源码随后实际 **1／1 通过、0 失败／跳过／取消**，125.964 秒（个测 125.027 秒）。真实原版／扩展切换、三端普通战斗上传与 Node 精确重放、R2 runner 零错误、两次实际 reload 隔离、原 Canvas 等待、最终 engine／实际 2D 棋盘及页面／资源／服务器零错误门槛均完成；Windows 适用的真实归属／优先级断言也依源码执行。原始日志 SHA256 `e9c76f78393c011266048bbcb4c5c24261dc3f8a4499c39a3366cd1ac11bd403`，不含 CPUProfiler 采样。Studio 的相同 `95ac02af` 第一例此前真实 Windows 已过；新不可变候选仍必须重新执行全部 48 个浏览器用例及完整包、升级、私配和附件尾段，两个专项不能代替这些门槛。默认 3D 多页面软件渲染冷启动的旧失败继续保留。

### 本次发布频道与最终决定

用户在获知默认 3D 冷启动限制后明确选择先发布，本次 `v0.3.0-rhine.8` 采用 **测试版／prerelease**，建议使用现有 `/?board=2d`。停止继续修默认 3D，不把这一已接受限制作为本轮发行阻断，也不声称原 3D 全过。发布请求明确 `prerelease=true`、`makeLatest=false`；草稿与公开发布均校验频道，发布后按 ID 核对测试版、确认稳定 latest 不变，并验证稳定联网更新继续拒绝测试版。正式稳定版用户不会自动升级至此测试版。

完整安装包、原生 Windows 2D／已通过机制、实际旧 `.6` 升级、六类私配及本地文件保留、重复更新、回滚、五附件重下哈希及源码一致性门槛全部保留。测试版升级使用已解压新包的 `更新旧版.bat --offline --source 新包目录 --target 旧安装目录`，不建议运行旧安装的普通联网更新来获取 prerelease。本轮所有旧标签与失败日志保留；尚未推送的本地 `.8` 标签将在发布频道收尾后固定至最终源码，已发布标签不变。

频道保护纯测试 **12／12** 通过，另与现有在线更新完整文件合跑 **40 项／37 通过／0 失败／3 Windows 专用跳过／0 取消**，507.465 毫秒；没有放宽联网更新器对 prerelease 的拒绝。三个 Windows 跳过仍需在真实 Windows 包回归执行。频道测试明确覆盖测试版禁止晋升 latest、稳定 latest 身份保留、错源码／标签／频道和非法字段；发布工作流在创建草稿前强制执行该测试。频道收尾不改变已通过 Windows／Linux 2D 专项的 13 份应用与夹具字节，不再为默认 3D 启动任何修复或重试。
