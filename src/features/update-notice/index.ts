export {
  compareVersions,
  getXiaochaoVersion,
  isNewerVersion,
  parseUpdateManifest,
  shouldPromptUpdateDialog,
  XIAOCHAO_UPDATE_MANIFEST_URL,
  XIAOCHAO_UPDATE_PAGE_URL
} from './update-manifest.ts';
export {
  createUpdateNoticeController,
  installUpdateNoticeController,
  type UpdateNoticeController,
  type UpdateNoticeSnapshot
} from './update-notice-controller.ts';
