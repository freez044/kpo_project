import { useEffect, useRef, type ReactNode } from 'react';

type Props = { children: ReactNode; onClose: () => void; busy?: boolean; labelledBy: string };
export default function Modal({ children, onClose, busy = false, labelledBy }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog ref={dialog} className="modal task-dialog" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    {children}
  </dialog>;
}
