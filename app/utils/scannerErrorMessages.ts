export function getScannerErrorMessage(error: Error): string {
  if (error.name === 'NotAllowedError') {
    return 'Camera permission was denied. Please allow camera access to scan barcodes.'
  }

  if (error.name === 'NotFoundError') {
    return 'No camera found on this device.'
  }

  if (error.name === 'NotReadableError') {
    return 'Camera is already in use by another application.'
  }

  if (error.name === 'OverconstrainedError') {
    return 'Could not find a suitable camera. Try using a different device.'
  }

  return 'A camera error occurred. Please try again or use a different device.'
}
