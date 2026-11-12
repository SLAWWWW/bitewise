'use client';

import { Download } from 'lucide-react';
import type { Locale } from '@/src/i18n/types';
import type { GuideMap } from './model';
import { guideCopy } from './content';
import { guideMarkdown } from './export';
import styles from './guide.module.css';

export function DownloadGuide({ maps, locale }: { maps: GuideMap[]; locale: Locale }) {
  function download() {
    const url = URL.createObjectURL(new Blob([guideMarkdown(maps, locale)], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `lumbung-visual-guide-${locale}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <button type="button" className={styles.download} onClick={download}><Download size={17} aria-hidden="true" />{guideCopy(locale).download}</button>;
}
