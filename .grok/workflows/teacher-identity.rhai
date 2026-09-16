let meta = #{
    name: "teacher-identity",
    description: "Read-only map of Krypton teacher identity, domain roles, and permission UI",
    when_to_use: "When asking what a teacher is, what they can see or edit, or how admins assign teachers",
    phases: [
        #{ title: "Scan", detail: "four read-only slices of the permission system" },
        #{ title: "Synthesize", detail: "one grounded report for Grill" },
    ],
};

let facts_schema = #{
    "type": "object",
    "required": ["summary", "facts"],
    "properties": #{
        "summary": #{ "type": "string" },
        "facts": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["claim", "file", "evidence"],
                "properties": #{
                    "claim": #{ "type": "string" },
                    "file": #{ "type": "string" },
                    "evidence": #{ "type": "string" },
                },
            },
        },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["markdown"],
    "properties": #{
        "markdown": #{ "type": "string" },
    },
};

fn scan_prompt(topic, files) {
    let p = "Read-only exploration of Krypton teacher identity. Workspace /Users/motricseven/Krypton. ";
    p += "Use read_file and grep. Do not edit. Do not guess production Mongo. ";
    p += "Topic: ";
    p += topic;
    p += " Start with these files, then follow real call chains: ";
    p += files;
    p += " Return at most 12 facts as {claim, file, evidence}. evidence must quote a real identifier or line. ";
    p += "Empty facts is allowed only after you actually read those files and found nothing on this topic.";
    p
}

phase("Scan");
let jobs = [
    #{
        prompt: scan_prompt(
            "PERM bits, PERM_TEACHER/PERM_STUDENT/PERM_DEFAULT, BUILTIN_ROLES, protected domain roles.",
            "packages/common/permission.ts, packages/hydrooj/src/model/builtin-roles.ts, packages/hydrooj/src/lib/domain-role-permission.ts, packages/hydrooj/src/model/builtin.ts",
        ),
        label: "scan-perm-bits",
        capability_mode: "read-only",
        output_schema: facts_schema,
    },
    #{
        prompt: scan_prompt(
            "How an admin designates a teacher: domain user role assignment, join, and any teacher-specific create path.",
            "packages/ui-next/src/pages/domain-manage.tsx, packages/hydrooj/src/handler/domain.ts, packages/ui-next/src/pages/domain-permission-workspace.tsx",
        ),
        label: "scan-assign-teacher",
        capability_mode: "read-only",
        output_schema: facts_schema,
    },
    #{
        prompt: scan_prompt(
            "What teachers can see or edit: problems, courses, contests, homework, records, exam events, problem bank. Note own() vs global PERM.",
            "packages/hydrooj/src/handler/course.ts, packages/hydrooj/src/handler/problem.ts, packages/hydrooj/src/handler/contest.ts, packages/hydrooj/src/handler/record.ts, packages/hydrooj/src/model/problem-access.ts",
        ),
        label: "scan-teacher-gates",
        capability_mode: "read-only",
        output_schema: facts_schema,
    },
    #{
        prompt: scan_prompt(
            "Existing visual permission UI: can admins add/remove bits on teacher without new UI? Compatibility with Hydro domain roles.",
            "packages/ui-next/src/pages/domain-permission-workspace.tsx, packages/ui-next/src/lib/domain-permission-state.ts, packages/hydrooj/src/lib/domain-role-permission.ts",
        ),
        label: "scan-permission-ui",
        capability_mode: "read-only",
        output_schema: facts_schema,
    },
];
let results = parallel(jobs);

let facts = [];
let i = 0;
for r in results {
    if r != () && r.success && r.output.facts != () {
        for f in r.output.facts {
            facts.push(f);
        }
    } else {
        log("scan slot " + i.to_string() + " produced no usable facts");
    }
    i += 1;
}
log(facts.len().to_string() + " raw facts collected");

phase("Synthesize");
let encoded = json_encode(facts);
let synth = "Write a Grill briefing in Chinese markdown for Krypton teacher identity. ";
synth += "Use only these verified facts JSON: ";
synth += encoded;
synth += " Structure: 1 教师是什么 2 管理员如何指定 3 教师能看见/改什么 4 现有可视化权限 UI 5 与 Hydro 权限是否兼容 6 真正的产品分叉（最多 6 个问句，带推荐答案）. ";
synth += "Do not invent files. If a fact is missing, say 未在本次扫描证实. Return {markdown}.";
let report = agent(synth, #{
    label: "synthesize-briefing",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let markdown = "# 教师身份只读探索\n\n本次扫描未产出可用摘要。";
if report != () && report.success && report.output.markdown != () {
    markdown = report.output.markdown;
}
let path = write_scratch_file("teacher-identity.md", markdown);
complete(#{ path: path, factCount: facts.len(), summary: "teacher identity briefing" });
