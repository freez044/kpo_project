export type User = { id: string; email: string; firstName: string; lastName: string; studyGroup: string | null; timezone: string };
export type Session = { accessToken: string; expiresIn: number; user: User };
