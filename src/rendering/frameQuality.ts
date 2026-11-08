export interface FrameQualitySettings {
    level: number;
    pixelRatio: number;
    shadowEvery: number;
    shadows: boolean;
}

const percentile = (values: number[], fraction: number): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

/** Presentation only: never changes physics time, input cadence or camera framing.
 * Sustained expensive/jittery frames lower resolution; repeated severe delays
 * also catch GPU pressure that CPU submission timing cannot measure. Recovery
 * is deliberately slower. Stable, cheap 30 Hz frames are not overload. */
export function createFrameQuality({maxPixelRatio = 1.75, minPixelRatio = .65} = {}) {
    const maximum = Math.max(.5, Math.min(2, Number.isFinite(maxPixelRatio) ? maxPixelRatio : 1));
    const minimum = Math.min(maximum, Math.max(.5, Number.isFinite(minPixelRatio) ? minPixelRatio : .65));
    const ratios = [maximum, Math.max(minimum, maximum * .85), Math.max(minimum, maximum * .7), minimum, minimum];
    const intervals: number[] = [], work: number[] = [];
    let windowFrames: number[] = [], windowWork: number[] = [];
    let previous: number | null = null, windowStart: number | null = null;
    let level = 0, frames = 0, slowFrames = 0, healthySince: number | null = null;
    let severeFrames = 0, lastReduction = -Infinity;
    const settings = (): FrameQualitySettings => ({level, pixelRatio: ratios[level], shadowEvery: level >= 3 ? 3 : level >= 2 ? 2 : 1, shadows: level < 4});
    const resetWindow = () => {windowFrames = []; windowWork = []; windowStart = null; healthySince = null;};
    return {
        get settings() {return settings();},
        sample(now: number, workMs: number, visible = true): FrameQualitySettings | null {
            if (!visible || !Number.isFinite(now) || !Number.isFinite(workMs) || workMs < 0) {
                previous = null; severeFrames = 0; resetWindow(); return null;
            }
            const interval = previous === null ? null : now - previous;
            previous = now;
            if (interval === null || interval <= 0) {severeFrames = 0; resetWindow(); return null;}
            severeFrames = interval > 50 ? severeFrames + 1 : 0;
            // One debugger/resume gap is not evidence of overload. Repeated
            // visible seconds-long frames are: dropping every such sample
            // would leave the slowest TVs permanently at maximum quality.
            if (interval > 1000 && severeFrames < 3) {resetWindow(); return null;}
            frames++; if (interval > 22) slowFrames++;
            intervals.push(interval); work.push(workMs);
            if (intervals.length > 180) {intervals.shift(); work.shift();}
            if (severeFrames >= 3 && now - lastReduction >= 500 && level < ratios.length - 1) {
                level++; lastReduction = now; severeFrames = 0; resetWindow(); return settings();
            }
            windowStart ??= now;
            windowFrames.push(interval); windowWork.push(workMs);
            if (now - windowStart < 1500 || windowFrames.length < 12) return null;
            const median = percentile(windowFrames, .5), p95 = percentile(windowFrames, .95);
            const slowRatio = windowFrames.filter(value => value > 22).length / windowFrames.length;
            const busy = percentile(windowWork, .75) > 12;
            const unstable = p95 > Math.max(24, median * 1.35);
            const overloaded = slowRatio > .35 && (busy || unstable);
            // A stable capped 30 Hz display must be able to recover after a
            // transient overload, just like 60/120 Hz displays.
            const healthy = percentile(windowWork, .95) < 9 &&
                (p95 < 19 || (median >= 31 && median <= 35 && p95 < 37));
            windowFrames = []; windowWork = []; windowStart = now;
            if (overloaded) {
                healthySince = null;
                // Shadows disappear only with sustained severe frame delays.
                if (level < 3) {level++; lastReduction = now; return settings();}
            } else if (healthy) {
                healthySince ??= now;
                if (level > 0 && now - healthySince >= 8000) {
                    level--; healthySince = now; return settings();
                }
            } else healthySince = null;
            return null;
        },
        diagnostics() {
            return {frames, slowFrames, frameP50Ms: percentile(intervals, .5), frameP95Ms: percentile(intervals, .95),
                frameP99Ms: percentile(intervals, .99), workP95Ms: percentile(work, .95), ...settings(),
                scope: 'local frame intervals and CPU/render submission; not motion-to-screen or GPU completion latency'};
        },
    };
}
