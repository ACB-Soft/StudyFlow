import { openDB, IDBPDatabase } from 'idb';

export interface AnnotationPath {
  points: { x: number, y: number }[];
  color: string;
  width: number;
  type: 'pen' | 'highlighter';
}

export interface PDFBook {
  id: string;
  name: string;
  data: ArrayBuffer;
  chapters: Chapter[];
  addedAt: number;
  lastPage?: number;
  annotations?: Record<number, AnnotationPath[]>;
}

export interface Chapter {
  id: string;
  title: string;
  pageNumber: number;
  endPage?: number;
  isCompleted: boolean;
  estimatedMinutes: number;
}

export interface StudySession {
  id: string;
  bookId: string;
  chapterId: string;
  durationMinutes: number;
  timestamp: number;
}

const DB_NAME = 'StudyFlowDB';
const DB_VERSION = 1;

export async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
    },
  });
}

export async function saveBook(book: PDFBook) {
  const db = await getDB();
  await db.put('books', book);
}

export async function getAllBooks(): Promise<PDFBook[]> {
  const db = await getDB();
  return db.getAll('books');
}

export async function getBook(id: string): Promise<PDFBook | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function deleteBook(id: string) {
  const db = await getDB();
  await db.delete('books', id);
}

export async function saveSession(session: StudySession) {
  const db = await getDB();
  await db.put('sessions', session);
}

export async function getAllSessions(): Promise<StudySession[]> {
  const db = await getDB();
  return db.getAll('sessions');
}
