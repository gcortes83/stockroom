import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { buttonStyles } from '@/shared/ui/button';
import { ErrorState } from '@/shared/ui/feedback';

export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="mx-auto max-w-xl space-y-4 py-24">
      <ErrorState message={notFound ? 'This page does not exist.' : 'Something went wrong while rendering this page.'} />
      <div className="text-center">
        <Link to="/shop" className={buttonStyles('secondary')}>
          Back to Discover
        </Link>
      </div>
    </div>
  );
}
