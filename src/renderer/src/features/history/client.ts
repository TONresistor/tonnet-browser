/** Typed main-process boundary owned by the history feature. */
export const historyClient = {
  getStats: () => window.electron.history.getStats(),
  search: (query: string, limit: number) => window.electron.history.search(query, limit),
  getRecent: (limit: number) => window.electron.history.getRecent(limit),
  getByDate: (start: number, end: number) => window.electron.history.getByDate(start, end),
  deleteEntry: (id: string) => window.electron.history.delete(id),
  deleteByDate: (start: number, end: number) => window.electron.history.deleteByDate(start, end),
  clear: () => window.electron.history.clear(),
  changeMode: (mode: 'memory' | 'persistent') => window.electron.history.changeMode(mode),
}
