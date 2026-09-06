export function EmptyProjectState() {
  return (
    <div className="flex flex-1 items-center justify-center text-center">
      <div className="flex flex-col items-center gap-2">
        <p className="text-[14px] font-medium text-text">No project selected</p>
        <p className="text-[13px] text-text-muted">Pick a project from the sidebar, or add a client to get started.</p>
      </div>
    </div>
  )
}
