import {GetStaticProps} from 'next';

interface Props {
	page: string;
}

export const getStaticProps: GetStaticProps<Props> = async () => {
	const page = 'SSG Fully Static';

	return {
		props: {
			page,
		},
	};
};

const Page = ({page}: Props) => (
	<div>
		<h1>Page {page}</h1>
	</div>
);

export default Page;
