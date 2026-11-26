import { useMemo, useState } from 'react';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Page, PageHeader } from '@/components/ui/page';
import { useBootstrap } from '@/lib/bootstrap';
import { CourseNodeEditor } from './node-editor/editor';
import { parseCourseNodeEditorSnapshot } from './node-editor/state';

export function CourseNodeMindmapEditPage() {
  const bootstrap = useBootstrap();
  const initial = useMemo(() => parseCourseNodeEditorSnapshot(bootstrap.page.data), [bootstrap.page.data]);
  const [title, setTitle] = useState(initial.courseNode.title);
  return (
    <Page width="full">
      <PageHeader
        breadcrumb={(
          <Breadcrumb items={[
            { label: '导图', href: `/mindmap?course=${encodeURIComponent(initial.courseNode.id)}` },
            { label: title },
          ]}
          />
        )}
        title={`${title} · 知识点`}
      />
      <CourseNodeEditor nodeId={initial.courseNode.id} initial={initial} onCourseTitleChange={setTitle} className="flex-1" />
    </Page>
  );
}

/** `pages/course/index.tsx` still re-exports this name. The old template route is gone. */
export const CourseMindmapEditPage = CourseNodeMindmapEditPage;
