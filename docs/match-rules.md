# Match scoring

Tennis is best of three sets: win two sets to win the match. Sets use ordinary
tennis games (0, 15, 30, 40, advantage); six games with a two-game lead wins the
set. At 6–6, a tie-break goes to seven points with a two-point lead. A match can
end 2–0, or a 1–1 tie leads to the deciding third set. Phone and TV no longer
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
checkpoint validation, a deciding third tennis set, and rematch normalization.
