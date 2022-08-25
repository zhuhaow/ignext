import type {NextApiRequest} from 'next';

export default function handler(_request: NextApiRequest): Response {
	return new Response('Hello World');
}

export const config = {
	runtime: 'experimental-edge',
};
