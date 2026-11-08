import type { BallPlayer } from './components/ball';
import type { PointReason, ServiceSide } from './tennisRules';

/** `quick` is accepted from older controllers and normalized to best of three. */
export type MatchFormat = 'full' | 'quick';

export interface CompletedSet {
    player1: number;
    player2: number;
}

export interface Score {
    player1: number;
    player2: number;
    targetPoints: 7;
    setsToWin: 2;
    setsPlayer1: number;
    setsPlayer2: number;
    server: BallPlayer;
    matchWinner: BallPlayer | null;
    completedSets: CompletedSet[];
    lastPoint: PointResult | null;
    format: MatchFormat;
    serviceSide: ServiceSide;
}

export interface PointResult {
    kind: 'point' | 'set' | 'match';
    player: 1 | 2;
    reason?: PointReason;
}

export function determinePointWinner(
    firstBounceInBounds: boolean,
    lastHitBy: BallPlayer | undefined,
    ballZ: number,
): BallPlayer {
    if (firstBounceInBounds) {
        return lastHitBy ?? (ballZ > 0 ? 'player2' : 'player1');
    }
    if (lastHitBy) {
        return lastHitBy === 'player1' ? 'player2' : 'player1';
    }
    return ballZ > 0 ? 'player2' : 'player1';
}

const opponent = (player: BallPlayer): BallPlayer => player === 'player1' ? 'player2' : 'player1';

/** Best of three sets. Every rally is one point; seven points by two wins a set.
 * Service follows a short tie-break: one serve, then two each; set starters alternate. */
export class ScoreSystem {
    private points = { player1: 0, player2: 0 };
    private sets = { player1: 0, player2: 0 };
    private server: BallPlayer = 'player1';
    private setStarter: BallPlayer = 'player1';
    private matchWinner: BallPlayer | null = null;
    private completedSets: CompletedSet[] = [];
    private lastPoint: PointResult | null = null;

    public constructor(_format: MatchFormat = 'full') {}

    public get isComplete(): boolean {
        return this.matchWinner !== null;
    }

    public getScore(): Score {
        return {
            player1: this.points.player1,
            player2: this.points.player2,
            targetPoints: 7,
            setsToWin: 2,
            setsPlayer1: this.sets.player1,
            setsPlayer2: this.sets.player2,
            server: this.server,
            matchWinner: this.matchWinner,
            completedSets: this.completedSets.map(set => ({ ...set })),
            lastPoint: this.lastPoint && { ...this.lastPoint },
            format: 'full',
            serviceSide: (this.points.player1 + this.points.player2) % 2 === 0 ? 'deuce' : 'ad',
        };
    }

    public awardPoint(winner: BallPlayer, loser: BallPlayer, reason?: PointReason): PointResult | null {
        if (this.matchWinner || winner === loser) return null;
        this.points[winner]++;
        let kind: PointResult['kind'] = 'point';
        if (this.points[winner] >= 7 && this.points[winner] - this.points[loser] >= 2) {
            this.sets[winner]++;
            this.completedSets.push({...this.points});
            if (this.sets[winner] === 2) {
                this.matchWinner = winner;
                kind = 'match';
            } else {
                this.points = {player1: 0, player2: 0};
                this.setStarter = opponent(this.setStarter);
                this.server = this.setStarter;
                kind = 'set';
            }
        } else {
            const played = this.points.player1 + this.points.player2;
            this.server = Math.floor((played + 1) / 2) % 2 === 0
                ? this.setStarter : opponent(this.setStarter);
        }
        this.lastPoint = {kind, player: winner === 'player1' ? 1 : 2, ...(reason ? {reason} : {})};
        return {...this.lastPoint};
    }

    public reset(_format: MatchFormat = 'full'): void {
        this.points = {player1: 0, player2: 0};
        this.sets = {player1: 0, player2: 0};
        this.server = 'player1';
        this.setStarter = 'player1';
        this.matchWinner = null;
        this.completedSets = [];
        this.lastPoint = null;
    }
}
