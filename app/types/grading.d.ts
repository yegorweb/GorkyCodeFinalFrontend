import type { components } from './backend'

declare global {
  type CreateBatchRequest = components['schemas']['CreateBatchRequest']
  type BackendBatch = components['schemas']['Batch']
  type PageReceipt = components['schemas']['PageReceipt']
  type BatchCloseResult = components['schemas']['BatchCloseResult']
  type ResultPage = components['schemas']['ResultPage']
  type ResultItem = ResultPage['items'][number]
  type AckResultsRequest = components['schemas']['AckResultsRequest']
  interface ProcessedScan {
    fio: string
    fio_confidence: number
    fio_review_required: boolean
    fio_ocr_source: string
    image_mime: string
    image_base64: string
  }
}

export { CreateBatchRequest, BackendBatch, PageReceipt, BatchCloseResult, ResultPage, ResultItem, AckResultsRequest, ProcessedScan }
