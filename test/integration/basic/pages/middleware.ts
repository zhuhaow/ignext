import {NextRequest, NextResponse} from 'next/server';

export function middleware(request: NextRequest) {
	return NextResponse.next(request);
}

export const config = {
	runtime: 'experimental-edge',
};
