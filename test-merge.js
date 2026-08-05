const foundPositions = [
  // Issue 1: H1 Title has an issue (maybe?)
  { from: 10, to: 50, cls: 'issue-highlight-error', issueIds: [1], kind: 'sop' },
  // Issue 2: WHY Paragraph has an issue
  { from: 215, to: 477, cls: 'issue-highlight', issueIds: [4], kind: 'sop' }
];

const merged = [];
for (const fp of foundPositions.sort((a, b) => a.from - b.from)) {
  const prev = merged[merged.length - 1];
  if (
    prev &&
    fp.from < prev.to &&
    fp.from >= prev.from &&
    fp.kind === prev.kind &&
    !prev.cls.includes('passed') &&
    !fp.cls.includes('passed')
  ) {
    prev.to = Math.max(prev.to, fp.to);
    if (fp.issueIds) {
      prev.issueIds = [...new Set([...(prev.issueIds || []), ...fp.issueIds])];
    }
  } else {
    merged.push(fp);
  }
}

console.log(merged);
