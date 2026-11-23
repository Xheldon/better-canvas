export type WriteIssue = {
  code: 'missing_targets' | 'missing_file'
  path: string
  nodeIds: string[]
  edgeIds: string[]
}

export type PanelChange =
  | { type: 'board_changed' | 'file_changed'; path: string; exists?: boolean }
  | { type: 'directory_changed' | 'resync' }
  | { type: 'write_warning'; issue: WriteIssue; sessionId?: string }

export interface ChangeBatch { cursor: string; changes: PanelChange[] }

export class WriteIssueError extends Error {
  readonly issue: WriteIssue
  readonly status = 409
  constructor(issue: WriteIssue) {
    super(issue.code === 'missing_file' ? 'The file is missing: ' + issue.path :
      'The requested items no longer exist: ' + [...issue.nodeIds, ...issue.edgeIds].join(', '))
    this.issue = issue
  }
}

export class MissingTargetsError extends Error {
  readonly nodeIds: string[]
  readonly edgeIds: string[]
  constructor(nodeIds: string[], edgeIds: string[], message = 'Unknown canvas target') {
    super(message + ': ' + [...nodeIds, ...edgeIds].join(', '))
    this.nodeIds = nodeIds
    this.edgeIds = edgeIds
  }
}
