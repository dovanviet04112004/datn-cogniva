import { Prisma } from '@prisma/client';
import type {
  exam as ExamRow,
  exam_attempt as ExamAttemptRow,
  exam_question as ExamQuestionRow,
  exam_response as ExamResponseRow,
  exam_violation as ExamViolationRow,
} from '@prisma/client';

export function jsonOrDbNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}

export function toExamDto(row: ExamRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    mode: row.mode,
    status: row.status,
    durationSeconds: row.duration_seconds,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    passingScore: row.passing_score,
    maxScore: row.max_score,
    showResults: row.show_results,
    shuffleQuestions: row.shuffle_questions,
    shuffleOptions: row.shuffle_options,
    allowReview: row.allow_review,
    maxAttempts: row.max_attempts,
    liveCode: row.live_code,
    currentQuestionIndex: row.current_question_index,
    minQuestions: row.min_questions,
    maxQuestions: row.max_questions,
    targetSE: row.target_se,
    antiCheat: row.anti_cheat,
    classroomId: row.classroom_id,
    conceptIds: row.concept_ids,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export function toQuestionDto(row: ExamQuestionRow) {
  return {
    id: row.id,
    examId: row.exam_id,
    type: row.type,
    prompt: row.prompt,
    promptHtml: row.prompt_html,
    attachments: row.attachments,
    options: row.options,
    correctAnswer: row.correct_answer,
    acceptableAnswers: row.acceptable_answers,
    rubric: row.rubric,
    testCases: row.test_cases,
    points: row.points,
    partialCredit: row.partial_credit,
    difficulty: row.difficulty,
    discrimination: row.discrimination,
    guessing: row.guessing,
    conceptId: row.concept_id,
    explanation: row.explanation,
    hint: row.hint,
    timeLimitSeconds: row.time_limit_seconds,
    orderIndex: row.order_index,
    createdAt: row.created_at,
  };
}

export function toStrippedQuestionDto(row: ExamQuestionRow) {
  return {
    id: row.id,
    type: row.type,
    prompt: row.prompt,
    promptHtml: row.prompt_html,
    attachments: row.attachments,
    options: row.options,
    points: row.points,
    timeLimitSeconds: row.time_limit_seconds,
    orderIndex: row.order_index,
  };
}

export function toAttemptDto(row: ExamAttemptRow) {
  return {
    id: row.id,
    examId: row.exam_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    score: row.score,
    maxScore: row.max_score,
    percentage: row.percentage,
    passed: row.passed,
    estimatedTheta: row.estimated_theta,
    thetaSE: row.theta_se,
    timeSpentSeconds: row.time_spent_seconds,
    questionsAnswered: row.questions_answered,
    violations: row.violations,
    cheatRiskScore: row.cheat_risk_score,
    flagged: row.flagged,
    flagReason: row.flag_reason,
    webcamRecordingUrl: row.webcam_recording_url,
    proctorNotes: row.proctor_notes,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    browserFingerprint: row.browser_fingerprint,
  };
}

export function toResponseDto(row: ExamResponseRow) {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    questionId: row.question_id,
    answer: row.answer,
    isCorrect: row.is_correct,
    pointsEarned: row.points_earned,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    responseTimeMs: row.response_time_ms,
    rankAtSubmit: row.rank_at_submit,
    aiGrading: row.ai_grading,
    manualGrading: row.manual_grading,
    needsReview: row.needs_review,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export function toViolationDto(row: ExamViolationRow) {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    type: row.type,
    severity: row.severity,
    metadata: row.metadata,
    timestamp: row.timestamp,
  };
}
