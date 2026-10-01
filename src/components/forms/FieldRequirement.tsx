import styles from './FieldRequirement.module.css';

export function FieldRequirement({ optional = false }: { optional?: boolean }) {
  return <span className={`${styles.badge} ${optional ? styles.optional : styles.required}`}>{optional ? '선택' : '필수'}</span>;
}
