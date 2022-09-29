import {GetServerSideProps, GetStaticPaths, GetStaticProps} from 'next';

interface Props {
	page: string;
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
	const page = context?.params?.page as string;

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

