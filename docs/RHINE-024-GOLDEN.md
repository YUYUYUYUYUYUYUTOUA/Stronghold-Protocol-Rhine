# 0.2.4 适配基准变动

对比适配前正式代码 `7476e8f3`，通过 `npm run golden:update` 重新计算全部287个场景。以下列出全部变动；其余场景不变。

- `diy.json`：`diy-059`, `diy-060`, `diy-061`, `diy-062`, `diy-063`, `diy-064`, `diy-065`, `diy-066`, `diy-067`, `diy-068`, `diy-069`, `diy-070`, `diy-071`, `diy-072`, `diy-073`, `diy-074`, `diy-075`, `diy-076`, `diy-077`, `diy-078`, `diy-079`, `diy-080`, `diy-081`, `diy-082`, `diy-083`, `diy-084`, `diy-085`, `diy-086`, `diy-087`, `diy-088`, `diy-089`, `diy-090`, `diy-091`, `diy-092`, `diy-093`, `diy-094`, `diy-095`, `diy-096`, `diy-097`, `diy-098`, `diy-099`, `diy-100`, `diy-101`, `diy-102`, `diy-103`, `diy-104`, `diy-105`, `diy-106`, `diy-107`, `diy-108`, `diy-109`, `diy-110`, `diy-111`, `diy-112`, `diy-113`, `diy-114`, `diy-115`, `diy-116`, `diy-117`, `diy-118`, `diy-119`, `diy-120`, `diy-121`, `diy-122`, `diy-123`, `diy-124`, `diy-125`, `diy-126`, `diy-127`, `diy-128`, `diy-129`, `diy-130`, `diy-131`, `diy-132`, `diy-133`, `diy-134`, `diy-135`, `diy-136`, `diy-137`, `diy-138`, `diy-139`, `diy-140`。
- `fields.json`：`boss-boss_1-pair`, `boss-boss_3-pair`, `boss-boss_4-solo`, `boss-boss_5-pair`, `boss-boss_7-pair`, `hidden-boss_10-solo`, `hidden-boss_9-pair`。
- `matches.json`：`coop2-ABYSS-10-boosted`, `coop2-HARD-4`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-3`, `coop2-NORMAL-5-coverage-diy`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-8-serverrun`, `coop3-ABYSS-5`, `coop4-ABYSS-7`, `coop4-FUNNY-6`, `solo-ABYSS-1`, `solo-ABYSS-2`, `solo-FUNNY-1`, `solo-FUNNY-2`, `solo-HARD-1`, `solo-HARD-2`, `solo-HARD-9-boosted`, `solo-NORMAL-1`, `solo-NORMAL-2`。
- `roster.json`：`roster-008`, `roster-016`, `roster-018`, `roster-019`, `roster-035`, `roster-036`, `roster-038`, `roster-045`。
- `standins.json`：`standin-07`。

原因：原版数据固定升级至上游 `v0.2.4`；新干员及模组改变自选场景分组和原生技能结果；共享库存、商店及机器人修复改变整局经济和出阵；伤害重定向、治疗及领袖修复改变战斗场景。以上变动直接继承上游0.2.4的基准，唯一例外为 `fields/hidden-boss_10-solo`：保留批准的余音反击来源边界，因此衍生脉冲不再次触发反伤。

相对上游 `bc50cac0`，程序逐项比较全部287个场景，仅该例外不同；不通过扩大误差或放宽断言匹配结果。
