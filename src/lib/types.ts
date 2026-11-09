import { formatSchoolYear } from "./school-year.js";

export type TargetLanguage = {
  id: string;
  language: string;
  alughaCode: string;
  name: string;
  status: "PENDING" | "TRANSLATING" | "TRANSLATED" | "VOICE_OVER_GENERATING" | "COMPLETED";
  deadline: string | null;
  translatedSrtPath: string | null;
  autoTranslationPath: string | null;
  reviewedTranslationPath: string | null;
  validatedBy: { userId: string; name: string; validatedAt: string }[];
};

export type Video = {
  id: string;
  code: string;
  name: string;
  alughaId: string;
  title: string | null;
  speaker: string | null;
  /** 1 = Y1, 2 = Y2, 3 = Y3, 9 = Other */
  schoolYear: number;
  quarter: number;
  classNumber: number;
  session: number;
  srcLanguage: string;
  status: "TRANSCRIBING" | "TRANSCRIBED";
  statusManuallySet: boolean;
  archived: boolean;
  videoUrl: string | null;
  customPrompt: string | null;
  sourceSrtPath: string | null;
  forDeeplPath: string | null;
  targetLanguages: TargetLanguage[];
  createdAt: string;
  updatedAt: string;
};

/** Compact row for tables: one line per video. */
export const videoRow = (video: Video) => ({
  code: video.code,
  schoolYear: formatSchoolYear(video.schoolYear),
  title: video.title ?? video.name,
  status: video.status,
  languages: video.targetLanguages.map((tl) => `${tl.language}:${tl.status}`).join(" "),
  alughaId: video.alughaId,
  archived: video.archived,
});

export const targetLanguageRow = (tl: TargetLanguage) => ({
  language: tl.language,
  name: tl.name,
  status: tl.status,
  deadline: tl.deadline,
  validatedBy: tl.validatedBy.map((v) => v.name).join(", ") || null,
  srt: tl.translatedSrtPath,
});
