import React from "react";

interface AnimatedSmileButtonProps {
  onClick: () => void;
}

const AnimatedSmileButton: React.FC<AnimatedSmileButtonProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="p-1.5 text-slate-400 hover:text-[#0a4d52] rounded-full transition-all cursor-pointer shrink-0"
      title="GIFs y Stickers"
    >
      <span className="inline-block anim-smile">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="smileGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#4ADE80"/>
              <stop offset="0.4" stopColor="#5EB7FF"/>
              <stop offset="0.75" stopColor="#C65EFF"/>
              <stop offset="1" stopColor="#4ADE80"/>
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" r="11" stroke="url(#smileGrad)" strokeWidth="1.6" fill="none"/>
          <circle cx="8.5" cy="10" r="1.3" fill="#0A2E28"/>
          <circle cx="15.5" cy="10" r="1.3" fill="#0A2E28"/>
          <path d="M8 14.5 C9.5 16.5, 14.5 16.5, 16 14.5" stroke="#0A2E28" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        </svg>
      </span>
    </button>
  );
};

export default AnimatedSmileButton;