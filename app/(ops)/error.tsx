'use client';
import { ErrorState } from '@/components/ui/ErrorState';
export default function OperationsError({retry}:{error:Error&{digest?:string};retry:()=>void}) {
  return <div className="direct-page"><ErrorState onRetry={retry}/></div>;
}
