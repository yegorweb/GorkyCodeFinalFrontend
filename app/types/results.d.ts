declare global {
  interface ResultTaskDetail { number: string; status: string; answer: string; expected: string; message: string; evidence: string; location: string }
  interface ResultErrorBox { number: string; page: number; left: number; top: number; width: number; height: number; target: string }
}
export { ResultTaskDetail, ResultErrorBox }
