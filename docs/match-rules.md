# Match scoring

Tennis is best of three sets: win two sets to win the match. Each set is
**first to seven points, winning by two**, with no games inside the set.
At 6–6, play continues until someone leads by two. A match can end 2–0,
or a 1–1 tie leads to the deciding third set. Service starts with one point,
then alternates every two points; the starting server changes each set.
Each completed set is announced, with a 3.2-second break before the next serve.
The final result names both the last set and the match winner. Phone and TV
offer a separate Quick format. Older `quick` commands are normalized to the
same best-of-three match. Configuration does not clear scores; New match does.

New table-tennis games go to **12 points, winning by two**. At 11–11, keep
playing until one player leads by two. Service changes after every two points
until 11–11, then after each point. Lets repeat the same serve without changing
the score or service turn. Point/game-point/deuce feedback comes from the same
score state as the winner calculation.

Table-tennis checkpoints include `rules.targetPoints`. New games write `12`.
Older saves that lack this field retain their original 11-point victory and
10–10 service rules; their next checkpoint writes `11` explicitly. Continuing
an old game does not move its finish line or rewrite its archived source.
Starting a new match uses 12. The TV displays the restored game's actual target.
The checkpoint envelope and structural schema stay at version 1; the bounded
per-game target is part of the saved rules rather than an implicit global default.

Automated checks cover both players, both first servers, repeated deuce,
one-point completion, duplicate scoring rejection, lets, legacy and current
table-tennis checkpoint validation, a deciding third tennis set, set breaks,
direct seven-point set scoring and rematch normalization.
