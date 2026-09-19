export function isCourseHidden(tdoc: { courseHidden?: boolean }): boolean {
    return tdoc.courseHidden === true;
}

export function courseAssignsUserGroups(tdoc: { courseGroupIds?: readonly unknown[] }): boolean {
    return (tdoc.courseGroupIds || []).length > 0;
}

export function courseVisibleTo(
    tdoc: { courseHidden?: boolean; courseGroupIds?: readonly unknown[] },
    myGroups: Set<string>,
    canManage: boolean,
): boolean {
    if (canManage) return true;
    if (isCourseHidden(tdoc)) return false;
    const groups = tdoc.courseGroupIds || [];
    if (!groups.length) return true;
    return groups.some((groupId) => myGroups.has(String(groupId)));
}
