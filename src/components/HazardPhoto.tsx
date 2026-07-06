/**
 * A hazard photo that degrades to an accessible caption if the image fails to
 * load (e.g. the bytes 404 after a hazard expires, or a data URL is corrupt).
 * Without this a broken <img> would render a browser's default broken-image
 * glyph with no explanation.
 */
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';

interface HazardPhotoProps {
  src: string;
  alt: string;
  className?: string;
}

export function HazardPhoto({ src, alt, className }: HazardPhotoProps) {
  const intl = useIntl();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <p
        className={`photo-unavailable${className ? ` ${className}` : ''}`}
        role="img"
        aria-label={intl.formatMessage(
          { id: 'photo.unavailableAria', defaultMessage: '{alt} — photo unavailable' },
          { alt },
        )}
      >
        <FormattedMessage id="photo.unavailable" defaultMessage="Photo unavailable" />
      </p>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
