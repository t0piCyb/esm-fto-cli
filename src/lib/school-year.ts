import { CliError } from "./errors.js";

/**
 * School year of a video, as the FTO app stores it: 1 = Y1, 2 = Y2, 3 = Y3,
 * 9 = Other (a video outside the three years of the course).
 */
export const OTHER_SCHOOL_YEAR = 9;

const BY_LABEL: Record<string, number> = { y1: 1, y2: 2, y3: 3, other: OTHER_SCHOOL_YEAR };

/** "Y1", "y2", "3", "Other" or "9" → the stored number */
export const parseSchoolYear = (value: string): number => {
  const key = value.trim().toLowerCase();
  const number = BY_LABEL[key] ?? (/^[1239]$/.test(key) ? Number(key) : undefined);
  if (number === undefined) {
    throw new CliError(2, `Invalid school year "${value}"`, "Use Y1, Y2, Y3 or Other");
  }
  return number;
};

export const formatSchoolYear = (schoolYear: number) =>
  schoolYear === OTHER_SCHOOL_YEAR ? "Other" : `Y${schoolYear}`;
