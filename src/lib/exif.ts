/**
 * Client entry point for EXIF stripping. The implementation is shared with the
 * server (defense in depth) and lives in shared/exif.ts.
 */
export {
  hasExif,
  stripExifBytes,
  stripExifFromDataUrl,
  dataUrlToBytes,
  bytesToDataUrl,
} from '../../shared/exif.ts';
