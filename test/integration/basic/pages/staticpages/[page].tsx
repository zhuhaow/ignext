import {GetStaticPaths, GetStaticProps} from 'next';

interface Props {
	page: string;
}

export const getStaticProps: GetStaticProps<Props> = async context => {
	const page = context?.params?.page as string;

	return {
		props: {
			page,
		},
	};
};

export const getStaticPaths: GetStaticPaths = async () => ({
	paths: ['SSG'].map(page => ({params: {page}})),
	fallback: false,
});

const Page = ({page}: Props) => (
	<div>
		<h1>Page {page}</h1>
	</div>
);

export default Page;
