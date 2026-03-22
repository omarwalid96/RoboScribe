'use client';

import { Activity } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Spotlight } from '@/components/ui/spotlight';
import { SplineScene } from '@/components/ui/splite';

export function SplineSceneBasic() {
  return (
    <Card className="relative h-[250px] md:h-[260px] w-full overflow-hidden border-white/10 bg-[#060606]/80 backdrop-blur-2xl ring-1 ring-white/5 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-all duration-300 hover:ring-white/10">
      <Spotlight className="-top-40 left-0 md:left-20 md:-top-20" fill="rgba(14, 165, 233, 0.15)" />

      {/* Decorative background gradients */}
      <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 via-transparent to-indigo-500/5 mix-blend-screen" />
      <div className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />

      <div className="flex h-full w-full">
        {/* Left Content Area */}
        <div className="relative z-10 flex w-full md:w-[65%] flex-col justify-center p-6 md:p-12 lg:pl-20">
          {/* Heading */}
          <h2 className="mb-4 bg-gradient-to-br from-white via-slate-200 to-slate-500 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent drop-shadow-sm md:text-5xl lg:text-5xl">
            Policy Evaluation & Data Collection
          </h2>

          {/* Description */}
          <p className="max-w-5xl text-sm leading-relaxed text-slate-400 font-medium md:text-base">
            Unified platform for high-fidelity humanoid data acquisition. Convert natural language into executable simulation episodes, capturing trajectory datasets to benchmark and train model policies.
          </p>
        </div>

        {/* Right Spline Scene Area */}
        <div className="relative hidden w-[60%] md:block">
          {/* Gradient Masks to blend Spline scene */}
          <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#060606]/80 to-transparent z-10" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#060606]/30 to-transparent z-10 pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#060606]/80 to-transparent z-10 pointer-events-none" />

          <SplineScene
            scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
            className="h-full w-full object-cover opacity-90 transition-opacity duration-700 hover:opacity-100"
          />
        </div>
      </div>
    </Card>
  );
}
