# v0.3.0 Rhine golden migration

Source baseline: `45d962f7d10f6d81cc000e2d49f145d131545529`. The merge imports only the released upstream `v0.3.0`, `c24e17eec3af1e6dedfa9935a6d15245cf2f4586`. All corpus inputs use the exact tagged `data/vanilla/` snapshot; expansion mechanics are tested separately.

The intentional migration includes upstream attack commitment, enemy body/range indexing, summon and skill fixes, bot decisions, shared/private pool changes, and moving carried unite HP/SP restoration after start effects. The approved fork changes also add three small-lobby BAN draws and retain six-seat rules in full-match scenarios. This is a version/gameplay migration, not a behavior-preserving refactor.

`npm run golden:update` regenerated all 288 scenarios (49 roster, 46 bonds, 22 fields, 21 matches, 10 stand-ins, 140 DIY). The exact changed scenario IDs below are computed against the formal `.6` baseline and separately against the released upstream `.3` golden files. No old baseline has been substituted for current runtime verification.

| Family | Scenarios | Changed from .6 | Changed from upstream .3 | Removed from .6 |
| --- | ---: | ---: | ---: | ---: |
| roster | 49 | 49 | 0 | 0 |
| bonds | 46 | 45 | 0 | 0 |
| fields | 22 | 22 | 1 | 0 |
| matches | 21 | 21 | 21 | 0 |
| standins | 10 | 10 | 0 | 0 |
| diy | 140 | 136 | 0 | 0 |

## roster

Changed from `.6`: `roster-001`, `roster-002`, `roster-003`, `roster-004`, `roster-005`, `roster-006`, `roster-007`, `roster-008`, `roster-009`, `roster-010`, `roster-011`, `roster-012`, `roster-013`, `roster-014`, `roster-015`, `roster-016`, `roster-017`, `roster-018`, `roster-019`, `roster-020`, `roster-021`, `roster-022`, `roster-023`, `roster-024`, `roster-025`, `roster-026`, `roster-027`, `roster-028`, `roster-029`, `roster-030`, `roster-031`, `roster-032`, `roster-033`, `roster-034`, `roster-035`, `roster-036`, `roster-037`, `roster-038`, `roster-039`, `roster-040`, `roster-041`, `roster-042`, `roster-043`, `roster-044`, `roster-045`, `roster-046`, `roster-047`, `roster-048`, `roster-049`.

Changed from upstream `.3`: none.

## bonds

Changed from `.6`: `bond-arcaneShip-low`, `bond-arcaneShip-high`, `bond-deputShip-low`, `bond-deputShip-high`, `bond-egirShip-low`, `bond-egirShip-high`, `bond-emptyShip-low`, `bond-emptyShip-high`, `bond-indomShip-low`, `bond-indomShip-high`, `bond-investShip-low`, `bond-investShip-high`, `bond-kazimierzShip-low`, `bond-kazimierzShip-high`, `bond-kjeragShip-low`, `bond-kjeragShip-high`, `bond-lateranoShip-low`, `bond-lateranoShip-high`, `bond-maniShip-low`, `bond-maniShip-high`, `bond-miraShip-low`, `bond-miraShip-high`, `bond-preciShip-low`, `bond-preciShip-high`, `bond-raidShip-low`, `bond-raidShip-high`, `bond-sargonShip-low`, `bond-sargonShip-high`, `bond-siracusaShip-low`, `bond-siracusaShip-high`, `bond-skillfulShip-low`, `bond-skillfulShip-high`, `bond-soloShip-low`, `bond-soloShip-high`, `bond-steadShip-low`, `bond-steadShip-high`, `bond-suntShip-low`, `bond-suntShip-high`, `bond-swiftShip-low`, `bond-swiftShip-high`, `bond-victoriaShip-low`, `bond-victoriaShip-high`, `bond-visiShip-low`, `bond-visiShip-high`, `bond-yanShip-low`.

Changed from upstream `.3`: none.

## fields

The sole difference from upstream `.3`, `hidden-boss_10-solo`, retains the already approved Echo/Thorns retaliation-ancestry fix from `57d1aebd` (documented in the [0.2.4 ledger](RHINE-024-GOLDEN.md)). `counterOriginTags` survive Echo’s deferred pulse queue, preventing a reflected hit from recursively creating a fresh retaliation chain. Upstream `.3` still omits this ancestry. This compatibility rule is preserved from `.6`; it is not a newly invented balance change. An isolated single-case A/B removed only these outgoing `counter`/`reflect` tags at runtime (151 calls, no file edits): the entire digest exactly matched upstream `.3` (`remainingDiffs=[]`), including every unit, event, RNG count and snapshot hash. Thorns events moved from 19 to upstream 36, and boss HP left from 7,316,378 to upstream 7,244,941.

Changed from `.6`: `boss-boss_1-pair`, `boss-boss_1-solo`, `boss-boss_2-pair`, `boss-boss_2-solo`, `boss-boss_3-pair`, `boss-boss_3-solo`, `boss-boss_4-pair`, `boss-boss_4-solo`, `boss-boss_5-pair`, `boss-boss_5-solo`, `boss-boss_6-pair`, `boss-boss_6-solo`, `boss-boss_7-pair`, `boss-boss_7-solo`, `hidden-boss_8-pair`, `hidden-boss_8-solo`, `hidden-boss_9-pair`, `hidden-boss_9-solo`, `hidden-boss_10-pair`, `hidden-boss_10-solo`, `unite-1`, `unite-2`.

Changed from upstream `.3`: `hidden-boss_10-solo`.

## matches

Changed from `.6`: `solo-FUNNY-1`, `solo-FUNNY-2`, `solo-NORMAL-1`, `solo-NORMAL-2`, `solo-HARD-1`, `solo-HARD-2`, `solo-ABYSS-1`, `solo-ABYSS-2`, `coop2-NORMAL-3`, `coop2-HARD-4`, `coop3-ABYSS-5`, `coop4-FUNNY-6`, `coop4-ABYSS-7`, `coop2-NORMAL-8-serverrun`, `solo-HARD-9-boosted`, `coop2-ABYSS-10-boosted`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-5-coverage-diy`, `coop2-NORMAL-1-unowned-roster`.

Changed from upstream `.3`: `solo-FUNNY-1`, `solo-FUNNY-2`, `solo-NORMAL-1`, `solo-NORMAL-2`, `solo-HARD-1`, `solo-HARD-2`, `solo-ABYSS-1`, `solo-ABYSS-2`, `coop2-NORMAL-3`, `coop2-HARD-4`, `coop3-ABYSS-5`, `coop4-FUNNY-6`, `coop4-ABYSS-7`, `coop2-NORMAL-8-serverrun`, `solo-HARD-9-boosted`, `coop2-ABYSS-10-boosted`, `coop2-NORMAL-14-standins`, `coop2-NORMAL-70-diy`, `coop2-NORMAL-1-coverage-standins`, `coop2-NORMAL-5-coverage-diy`, `coop2-NORMAL-1-unowned-roster`.

## standins

Changed from `.6`: `standin-01`, `standin-02`, `standin-03`, `standin-04`, `standin-05`, `standin-06`, `standin-07`, `standin-08`, `standin-09`, `standin-10`.

Changed from upstream `.3`: none.

## diy

Changed from `.6`: `diy-001`, `diy-002`, `diy-003`, `diy-004`, `diy-005`, `diy-006`, `diy-007`, `diy-008`, `diy-009`, `diy-011`, `diy-013`, `diy-014`, `diy-015`, `diy-016`, `diy-017`, `diy-018`, `diy-019`, `diy-020`, `diy-021`, `diy-022`, `diy-023`, `diy-024`, `diy-025`, `diy-026`, `diy-027`, `diy-028`, `diy-029`, `diy-030`, `diy-031`, `diy-032`, `diy-033`, `diy-034`, `diy-035`, `diy-036`, `diy-037`, `diy-038`, `diy-039`, `diy-040`, `diy-041`, `diy-042`, `diy-043`, `diy-044`, `diy-045`, `diy-046`, `diy-047`, `diy-048`, `diy-049`, `diy-050`, `diy-051`, `diy-052`, `diy-053`, `diy-054`, `diy-055`, `diy-056`, `diy-057`, `diy-058`, `diy-059`, `diy-060`, `diy-061`, `diy-062`, `diy-063`, `diy-064`, `diy-065`, `diy-066`, `diy-067`, `diy-068`, `diy-069`, `diy-070`, `diy-071`, `diy-072`, `diy-073`, `diy-074`, `diy-075`, `diy-076`, `diy-077`, `diy-078`, `diy-079`, `diy-080`, `diy-081`, `diy-082`, `diy-083`, `diy-084`, `diy-085`, `diy-086`, `diy-087`, `diy-088`, `diy-089`, `diy-090`, `diy-091`, `diy-092`, `diy-094`, `diy-095`, `diy-096`, `diy-097`, `diy-098`, `diy-099`, `diy-100`, `diy-101`, `diy-102`, `diy-103`, `diy-104`, `diy-105`, `diy-106`, `diy-107`, `diy-108`, `diy-109`, `diy-110`, `diy-111`, `diy-112`, `diy-113`, `diy-114`, `diy-115`, `diy-116`, `diy-117`, `diy-118`, `diy-119`, `diy-120`, `diy-121`, `diy-122`, `diy-123`, `diy-124`, `diy-125`, `diy-126`, `diy-127`, `diy-128`, `diy-129`, `diy-130`, `diy-131`, `diy-132`, `diy-133`, `diy-135`, `diy-136`, `diy-137`, `diy-138`, `diy-139`, `diy-140`.

Changed from upstream `.3`: none.
