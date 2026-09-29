import { STAGE_PIPELINE, stageToPipelineIndex, type ProjectStage, type ProjectStatus } from "@/lib/types";

export function StatusPipeline({
  stage,
  status,
  ideaOnly,
  ideaIndex,
}: {
  stage?: ProjectStage;
  status?: ProjectStatus;
  ideaOnly?: boolean;
  ideaIndex?: number;
}) {
  const active = ideaOnly
    ? ideaIndex ?? 0
    : stage && status
      ? stageToPipelineIndex(stage, status)
      : 0;

  return (
    <div className="w-full overflow-x-auto">
      <ol className="flex min-w-[640px] items-center gap-1 py-2">
        {STAGE_PIPELINE.map((step, i) => {
          const done = i < active;
          const current = i === active;
          return (
            <li key={step.key} className="flex flex-1 items-center gap-1">
              <div className="flex flex-col items-center gap-1 flex-1">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                    done
                      ? "bg-teal-700 text-white"
                      : current
                        ? "bg-navy text-white ring-4 ring-teal-100"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {i + 1}
                </div>
                <span
                  className={`text-[10px] sm:text-xs text-center ${
                    current ? "font-semibold text-navy" : "text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STAGE_PIPELINE.length - 1 && (
                <div className={`mb-4 h-0.5 flex-1 ${done ? "bg-teal-600" : "bg-slate-200"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
