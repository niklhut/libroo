import { describe, expect, it } from 'vitest'
import { getScannerErrorMessage } from '../../app/utils/scannerErrorMessages'

describe('getScannerErrorMessage', () => {
  it.each([
    ['NotAllowedError', 'Camera permission was denied. Please allow camera access to scan barcodes.'],
    ['NotFoundError', 'No camera found on this device.'],
    ['NotReadableError', 'Camera is already in use by another application.'],
    ['OverconstrainedError', 'Could not find a suitable camera. Try using a different device.']
  ])('returns the friendly message for %s', (name, expectedMessage) => {
    const error = new Error('camera failure')
    error.name = name

    expect(getScannerErrorMessage(error)).toBe(expectedMessage)
  })

  it('does not expose raw details for unknown errors', () => {
    const rawMessage = 'Sensitive camera diagnostic: device-id=abc123'
    const error = new Error(rawMessage)
    error.name = 'UnknownCameraError'

    const message = getScannerErrorMessage(error)

    expect(message).toBe('A camera error occurred. Please try again or use a different device.')
    expect(message).not.toContain(rawMessage)
  })
})
