export function DomainPermissionCopy({ name, detail }: { name: string; detail?: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-foreground">{name}</span>
      {detail ? <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{detail}</span> : null}
    </span>
  );
}
