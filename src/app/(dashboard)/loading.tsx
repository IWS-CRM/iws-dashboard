export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-48 rounded-lg bg-slate-200" />
      <div className="mt-2 h-4 w-72 max-w-full rounded bg-slate-200" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-24 rounded-xl border border-slate-200 bg-white"
          />
        ))}
      </div>
      <div className="mt-8 h-72 rounded-xl border border-slate-200 bg-white" />
    </div>
  );
}
