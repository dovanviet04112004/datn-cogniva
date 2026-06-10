/**
 * Domain logic THUẦN (learning science) — share web + mobile.
 *
 * Chỉ chứa hàm tất định, không I/O, không native dep:
 *   - BKT (Bayesian Knowledge Tracing): updateMastery / decay / INITIAL_SCORE
 *   - FSRS pure: FsrsFields type + computeRetrievability
 *
 * Scheduler FSRS (cần `ts-fsrs`) KHÔNG ở đây — nằm server-side trong apps/web.
 */
export * from './bkt';
export * from './fsrs';
