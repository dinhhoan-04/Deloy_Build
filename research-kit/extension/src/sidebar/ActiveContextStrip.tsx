interface PageEntry {
  site: string
  url: string
  query?: string
}

interface ActiveContextStripProps {
  models: PageEntry[]
}

const siteIcons: Record<string, string> = {
  elicit: '📊',
  scispace: '🔬',
  consensus: '✓',
}

export function ActiveContextStrip({ models }: ActiveContextStripProps) {
  if (models.length === 0) {
    return (
      <div className="bg-slate-800/50 border-b border-slate-700 p-3">
        <div className="text-xs text-slate-500">
          Open Elicit, SciSpace, or Consensus tabs to include them in analysis
        </div>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 border-b border-slate-700 p-3">
      <div className="text-xs text-slate-400 mb-2">Analyzing {models.length} page(s):</div>
      <div className="flex flex-wrap gap-2">
        {models.map((model, idx) => (
          <div
            key={idx}
            className="bg-slate-700 px-2 py-1 rounded text-xs text-slate-200 flex items-center gap-1"
          >
            <span>{siteIcons[model.site] || '🌐'}</span>
            <span className="truncate max-w-[150px]" title={model.url}>
              {model.site}
            </span>
            {model.query && (
              <span className="text-slate-400 text-xs truncate">
                · {model.query.substring(0, 30)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
