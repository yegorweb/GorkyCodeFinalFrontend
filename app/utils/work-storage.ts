import { toRaw } from 'vue'
let opened: Promise<IDBDatabase> | undefined
function openWorksDatabase() {
  return opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('proveryator-works', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('works', { keyPath: 'id' })
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = undefined }; resolve(request.result) }
    request.onerror = () => { opened = undefined; reject(request.error) }
  })
}
async function workTransaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openWorksDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('works', mode); const request = operation(tx.objectStore('works'))
    let value: T
    request.onsuccess = () => { value = request.result }
    tx.oncomplete = () => resolve(value)
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Не удалось сохранить работу в браузере.'))
  })
}
export const listStoredWorks = () => workTransaction('readonly', store => store.getAll() as IDBRequest<Work[]>)
export const getStoredWork = (id: string) => workTransaction('readonly', store => store.get(id) as IDBRequest<Work | undefined>)
export const putStoredWork = (work: Work) => {
  const value = { ...toRaw(work), spec: JSON.parse(JSON.stringify(work.spec)), layout: work.layout ? JSON.parse(JSON.stringify(work.layout)) : undefined, previews: work.previews ? JSON.parse(JSON.stringify(work.previews)) : undefined }
  return workTransaction('readwrite', store => store.put(value))
}
