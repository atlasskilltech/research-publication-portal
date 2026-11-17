import Icon from "@/components/ui/Icon";
import Button from "@/components/ui/Button";

export default function NoAccessMessage() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-white px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-soft text-muted">
        <Icon name="lock" size={26} />
      </span>
      <h1 className="text-xl font-bold text-ink">This page is for administrators</h1>
      <p className="mt-2 max-w-md text-sm text-muted">You can see and add your own achievements on the My achievements page.</p>
      <div className="mt-5"><Button href="/achievements">Go to My achievements</Button></div>
    </div>
  );
}
