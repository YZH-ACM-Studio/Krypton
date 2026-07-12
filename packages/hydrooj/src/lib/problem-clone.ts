export interface ProblemCloneFile {
    name: string;
    path: string;
}

export interface ProblemCloneFileFailure {
    sourceDomainId: string;
    sourceProblemId: number;
    targetDomainId: string;
    targetProblemId: number;
    filename: string;
    error: unknown;
}

export async function copyProblemStorageFiles(input: {
    files: ProblemCloneFile[];
    sourceDomainId: string;
    sourceProblemId: number;
    targetDomainId: string;
    targetProblemId: number;
    targetPrefix: string;
    copy: (sourcePath: string, targetPath: string) => Promise<void>;
    onFailure: (failure: ProblemCloneFileFailure) => void;
}): Promise<void> {
    for (const file of input.files) {
        try {
            // Deliberately sequential: stop at the first exact failed file.

            await input.copy(file.path, `${input.targetPrefix}${file.name}`);
        } catch (error) {
            const failure = {
                sourceDomainId: input.sourceDomainId,
                sourceProblemId: input.sourceProblemId,
                targetDomainId: input.targetDomainId,
                targetProblemId: input.targetProblemId,
                filename: file.name,
                error,
            };
            input.onFailure(failure);
            throw new Error(`Problem clone failed while copying ${file.name}`, { cause: error });
        }
    }
}
