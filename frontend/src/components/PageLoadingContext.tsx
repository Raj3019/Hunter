import { createContext, useContext } from "react";

export type PageLoadingState = {
  title: string;
  description?: string;
};

type PageLoadingSetter = (state: PageLoadingState | null) => void;

const PageLoadingContext = createContext<PageLoadingSetter>(() => {});

function usePageLoading() {
  return useContext(PageLoadingContext);
}

export { PageLoadingContext, usePageLoading };
