declare global {
  type StudioTaskKind = 'choice' | 'short' | 'calculation' | 'long' | 'drawing'
  type StudioPaper = 'auto' | 'grid' | 'lines' | 'blank'
  interface StudioImage { id: string; data_base64: string; caption: string; task_number?: number; source_page?: number }
  interface StudioTask {
    id: string; prompt: string; kind: StudioTaskKind; paper: StudioPaper;
    options: string[]; lines: number | null; solution_guide: string; images?: StudioImage[];
    source_text?: string; review_notes?: string[];
    source_number?: number; source_page?: number; source_pages?: number[];
    sourceKeys?: string[]; sourceLabel?: string;
    answer?: string; answer_type?: ConstructorTask['answer_type']; answer_confirmed?: boolean; topic?: string;
  }
  interface StudioExam {
    title: string; subject: string; grade: string; variant: string; duration: string;
    style: 'classic' | 'stem' | 'writing'; density: 'compact' | 'comfortable';
    space_factor: number; instructions: string; tasks: StudioTask[];
  }
  interface StudioExample { name: string; spec: StudioExam }
  interface StudioPage { page_number: number; mime: string; image_base64: string }
  interface StudioPreview { pdf_base64: string; template_id: string; page_count: number; pages: StudioPage[] }
  interface StudioLayout { template_id: string; revision: string | number; page_count: number; pages: Record<string, unknown>[]; [key: string]: unknown }
  interface StudioParseResponse { tasks: StudioTask[]; instructions?: string; warnings?: string[] }
  interface StudioReviewFigure extends StudioImage { taskId: string; sourceKey: string; batch_page: number; filename: string }
  interface StudioReview {
    tasks: StudioTask[]; instructions: string; warnings: string[]; figures: StudioReviewFigure[];
    sourceSnapshot?: string; examSnapshot?: string;
    sourceBaselines: Record<string, { prompt: string; sourceText: string }>;
  }
  interface StudioImport {
    text: string; warnings?: string[]; figures?: StudioImage[]; page_count?: number;
    math_job?: { id: string; total?: number }; math_pending?: { token: string }[];
  }
  interface StudioSourcePage { id: string; filename: string; text: string; warnings: string[]; figures: StudioImage[]; preview?: string; page_count: number }
  interface StudioEstimate { task_id: string; lines: number; height_mm: number; source: string; reasons: string[]; reserve_percent: number; capped?: boolean }
  interface StudioCapability { provider: 'local' | 'yandex'; ready: boolean; cloud: boolean; label: string }
  interface StudioMathJob { id: string; total: number; completed: number; status: string; tokens: string[]; applied: string[]; error?: string }
  type WorkStatus = 'ready' | 'draft'
  interface Work {
    id: string; ownerId: number; title: string; status: WorkStatus; createdAt: string; updatedAt: string;
    spec: StudioExam; pdf?: Blob; layout?: StudioLayout; previews?: StudioPage[]; batchId?: string; startedAt?: string;
    kind: 'draft' | 'version'; draftId: string; draftRevision: number; familyId: string;
    workId?: number; assignmentId?: string; keyReady: boolean; versionNumber?: number;
  }
}

export { StudioTaskKind, StudioPaper, StudioImage, StudioTask, StudioExam, StudioExample, StudioPage, StudioPreview, StudioLayout, StudioParseResponse, StudioReviewFigure, StudioReview, StudioImport, StudioSourcePage, StudioEstimate, StudioCapability, StudioMathJob, WorkStatus, Work }
